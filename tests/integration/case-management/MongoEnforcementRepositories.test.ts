import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { AnalystDecision } from '../../../src/modules/case-management/domain/model/aggregates/AnalystDecision.js';
import { EnforcementAction } from '../../../src/modules/case-management/domain/model/aggregates/EnforcementAction.js';
import { ApprovalRequest } from '../../../src/modules/case-management/domain/model/aggregates/ApprovalRequest.js';
import { CustomerOutgoingEvent } from '../../../src/modules/case-management/domain/model/aggregates/CustomerOutgoingEvent.js';
import { createAnalystDecisionId } from '../../../src/modules/case-management/domain/model/value-objects/AnalystDecisionId.js';
import { createEnforcementActionId } from '../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import { createApprovalRequestId } from '../../../src/modules/case-management/domain/model/value-objects/ApprovalRequestId.js';
import { createCustomerOutgoingEventId } from '../../../src/modules/case-management/domain/model/value-objects/CustomerOutgoingEventId.js';
import { createCaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { MongoAnalystDecisionRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoAnalystDecisionRepository.js';
import { MongoEnforcementActionRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoEnforcementActionRepository.js';
import { MongoApprovalRequestRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoApprovalRequestRepository.js';
import { MongoCustomerOutgoingEventRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoCustomerOutgoingEventRepository.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-01T00:00:02.000Z'));

describe('Mongo enforcement repositories (integration)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    replicaSet = await startReplicaSetMongo();
    const connection = await connectMongo(replicaSet.getUri(), 'anti_fraud_test');
    client = connection.client;
    db = connection.db;
    await ensureIndexes(db);
  });

  afterAll(async () => {
    await client.close();
    await replicaSet.stop();
  });

  afterEach(async () => {
    await Promise.all([
      db.collection('analyst_decisions').deleteMany({}),
      db.collection('enforcement_actions').deleteMany({}),
      db.collection('approval_requests').deleteMany({}),
      db.collection('customer_outgoing_events').deleteMany({}),
    ]);
  });

  it('round-trips analyst decisions, actions, approvals, and outbox rows', async () => {
    const decisions = new MongoAnalystDecisionRepository(db);
    const actions = new MongoEnforcementActionRepository(db);
    const approvals = new MongoApprovalRequestRepository(db);
    const outbox = new MongoCustomerOutgoingEventRepository(db);

    const decision = AnalystDecision.create({
      id: createAnalystDecisionId(oid('decision-1')),
      caseId: createCaseId(oid('case-1')),
      organizationId: oid('org-1'),
      decision: 'FRAUD_CONFIRMED',
      confidence: 88,
      comment: 'confirmed',
      createdBy: oid('user-1'),
      now: NOW,
    });
    const action = EnforcementAction.create({
      id: createEnforcementActionId(oid('action-1')),
      caseId: createCaseId(oid('case-1')),
      organizationId: oid('org-1'),
      analystDecisionId: decision.id,
      actionType: 'BLOCK',
      targetType: 'CUSTOMER',
      targetId: oid('customer-1'),
      createdBy: oid('user-1'),
      now: NOW,
    });
    const approval = ApprovalRequest.create({
      id: createApprovalRequestId(oid('approval-1')),
      enforcementActionId: action.id,
      requesterId: oid('user-1'),
      now: NOW,
    });
    const event = CustomerOutgoingEvent.create({
      id: createCustomerOutgoingEventId(oid('outbox-1')),
      organizationId: oid('org-1'),
      customerId: oid('customer-1'),
      enforcementActionId: action.id,
      webhookUrl: 'https://example.com/hook',
      eventType: 'ENFORCEMENT_EXECUTED',
      payload: {
        enforcement_action_id: action.id,
        case_id: oid('case-1'),
        action_type: 'BLOCK',
        target_type: 'CUSTOMER',
        target_id: oid('customer-1'),
        organization_id: oid('org-1'),
      },
      now: NOW,
    });

    await decisions.save(decision);
    await actions.save(action);
    await approvals.save(approval);
    await outbox.save(event);

    expect((await decisions.findById(decision.id))?.confidence).toBe(88);
    expect((await actions.findByCaseId(action.caseId)).map((row) => row.id)).toEqual([action.id]);
    expect((await approvals.findByEnforcementActionId(action.id))?.status).toBe('PENDING');
    expect((await outbox.findByEnforcementActionId(action.id))?.status).toBe('PENDING');
  });

  it('keeps multiple open enforcement actions for the same case', async () => {
    const actions = new MongoEnforcementActionRepository(db);
    const caseId = createCaseId(oid('case-1'));
    const first = EnforcementAction.create({
      id: createEnforcementActionId(oid('action-1')),
      caseId,
      organizationId: oid('org-1'),
      analystDecisionId: createAnalystDecisionId(oid('decision-1')),
      actionType: 'BLOCK',
      targetType: 'CUSTOMER',
      targetId: oid('customer-1'),
      createdBy: oid('user-1'),
      now: NOW,
    });
    const second = EnforcementAction.create({
      id: createEnforcementActionId(oid('action-2')),
      caseId,
      organizationId: oid('org-1'),
      analystDecisionId: createAnalystDecisionId(oid('decision-2')),
      actionType: 'REVIEW',
      targetType: 'CUSTOMER',
      targetId: oid('customer-1'),
      createdBy: oid('user-1'),
      now: NOW,
    });

    await actions.save(first);
    await actions.save(second);

    expect(await actions.findByCaseId(caseId)).toHaveLength(2);
  });

  it('claims only due PENDING outbox events', async () => {
    const outbox = new MongoCustomerOutgoingEventRepository(db);
    const payload = {
      enforcement_action_id: oid('action-1'),
      case_id: oid('case-1'),
      action_type: 'BLOCK',
      target_type: 'CUSTOMER',
      target_id: oid('customer-1'),
      organization_id: oid('org-1'),
    };
    const due = CustomerOutgoingEvent.create({
      id: createCustomerOutgoingEventId(oid('outbox-1')),
      organizationId: oid('org-1'),
      customerId: oid('customer-1'),
      enforcementActionId: createEnforcementActionId(oid('action-1')),
      webhookUrl: 'https://example.com/hook',
      eventType: 'ENFORCEMENT_EXECUTED',
      payload,
      now: NOW,
    });
    const waiting = CustomerOutgoingEvent.create({
      id: createCustomerOutgoingEventId(oid('outbox-2')),
      organizationId: oid('org-1'),
      customerId: oid('customer-1'),
      enforcementActionId: createEnforcementActionId(oid('action-2')),
      webhookUrl: 'https://example.com/hook',
      eventType: 'ENFORCEMENT_EXECUTED',
      payload,
      now: NOW,
    }).recordFailure({ responseStatus: 500, now: LATER });

    await outbox.save(due);
    await outbox.save(waiting);

    const claimed = await outbox.claimPending(fromDate(new Date('2026-01-01T00:00:03.000Z')), 10);
    expect(claimed.map((event) => event.id)).toEqual([due.id]);
  });
});
