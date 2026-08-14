import { oid } from '../../../support/oid.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { AnalystDecision } from '../../../../src/modules/case-management/domain/model/aggregates/AnalystDecision.js';
import { EnforcementAction } from '../../../../src/modules/case-management/domain/model/aggregates/EnforcementAction.js';
import { ApprovalRequest } from '../../../../src/modules/case-management/domain/model/aggregates/ApprovalRequest.js';
import { CustomerOutgoingEvent } from '../../../../src/modules/case-management/domain/model/aggregates/CustomerOutgoingEvent.js';
import { createAnalystDecisionId } from '../../../../src/modules/case-management/domain/model/value-objects/AnalystDecisionId.js';
import { createEnforcementActionId } from '../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import { createApprovalRequestId } from '../../../../src/modules/case-management/domain/model/value-objects/ApprovalRequestId.js';
import { createCustomerOutgoingEventId } from '../../../../src/modules/case-management/domain/model/value-objects/CustomerOutgoingEventId.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { InMemoryAnalystDecisionRepository } from '../../../helpers/case-management/InMemoryAnalystDecisionRepository.js';
import { InMemoryEnforcementActionRepository } from '../../../helpers/case-management/InMemoryEnforcementActionRepository.js';
import { InMemoryApprovalRequestRepository } from '../../../helpers/case-management/InMemoryApprovalRequestRepository.js';
import { InMemoryCustomerOutgoingEventRepository } from '../../../helpers/case-management/InMemoryCustomerOutgoingEventRepository.js';
import { FakeOutgoingWebhookClient } from '../../../helpers/case-management/FakeOutgoingWebhookClient.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-01T00:00:02.000Z'));

describe('InMemory enforcement ports', () => {
  it('saves and finds analyst decisions by id and case', async () => {
    const repo = new InMemoryAnalystDecisionRepository();
    const decision = AnalystDecision.create({
      id: createAnalystDecisionId(oid('decision-1')),
      caseId: createCaseId(oid('case-1')),
      organizationId: oid('org-1'),
      decision: 'FRAUD_CONFIRMED',
      confidence: 70,
      comment: 'x',
      createdBy: oid('user-1'),
      now: NOW,
    });

    await repo.save(decision);

    expect(await repo.findById(decision.id)).toBe(decision);
    expect(await repo.findByCaseId(decision.caseId)).toEqual([decision]);
    expect(await repo.findByCaseId(createCaseId(oid('case-missing')))).toEqual([]);
  });

  it('allows multiple concurrent enforcement actions per case', async () => {
    const repo = new InMemoryEnforcementActionRepository();
    const first = EnforcementAction.create({
      id: createEnforcementActionId(oid('action-1')),
      caseId: createCaseId(oid('case-1')),
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
      caseId: createCaseId(oid('case-1')),
      organizationId: oid('org-1'),
      analystDecisionId: createAnalystDecisionId(oid('decision-2')),
      actionType: 'REVIEW',
      targetType: 'CUSTOMER',
      targetId: oid('customer-1'),
      createdBy: oid('user-1'),
      now: NOW,
    });

    await repo.save(first);
    await repo.save(second);

    const found = await repo.findByCaseId(createCaseId(oid('case-1')));
    expect(found).toHaveLength(2);
    expect(found.map((action) => action.id).sort()).toEqual([first.id, second.id].sort());
  });

  it('finds approval requests by enforcement action id', async () => {
    const repo = new InMemoryApprovalRequestRepository();
    const request = ApprovalRequest.create({
      id: createApprovalRequestId(oid('approval-1')),
      enforcementActionId: createEnforcementActionId(oid('action-1')),
      requesterId: oid('user-1'),
      now: NOW,
    });

    await repo.save(request);

    expect(await repo.findByEnforcementActionId(request.enforcementActionId)).toBe(request);
    expect(await repo.findById(request.id)).toBe(request);
  });

  it('claims only due PENDING outbox events with attempts < 5', async () => {
    const repo = new InMemoryCustomerOutgoingEventRepository();
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
    // attempts=1, lastAttemptAt=LATER (00:00:02), backoff 2s → due at 00:00:04
    const waitingBackoff = CustomerOutgoingEvent.create({
      id: createCustomerOutgoingEventId(oid('outbox-2')),
      organizationId: oid('org-1'),
      customerId: oid('customer-1'),
      enforcementActionId: createEnforcementActionId(oid('action-2')),
      webhookUrl: 'https://example.com/hook',
      eventType: 'ENFORCEMENT_EXECUTED',
      payload,
      now: NOW,
    }).recordFailure({ responseStatus: 500, now: LATER });

    await repo.save(due);
    await repo.save(waitingBackoff);

    const claimed = await repo.claimPending(fromDate(new Date('2026-01-01T00:00:03.000Z')), 10);
    expect(claimed.map((event) => event.id)).toEqual([due.id]);
  });

  it('records webhook posts via FakeOutgoingWebhookClient', async () => {
    const client = new FakeOutgoingWebhookClient();
    client.nextResult = { statusCode: 202, ok: true };

    const result = await client.post({
      url: 'https://example.com/hook',
      payload: { a: 1 },
    });

    expect(result).toEqual({ statusCode: 202, ok: true });
    expect(client.posts).toHaveLength(1);
    expect(client.posts[0]?.url).toBe('https://example.com/hook');
  });
});
