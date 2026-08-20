import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { createAuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { MongoCaseRoutingRuleRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoCaseRoutingRuleRepository.js';
import { MongoUnitOfWork } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { createActivateRoutingRuleUseCase } from '../../../src/modules/case-management/application/ActivateRoutingRule.js';
import { createDeactivateRoutingRuleUseCase } from '../../../src/modules/case-management/application/DeactivateRoutingRule.js';
import { CaseRoutingRule } from '../../../src/modules/case-management/domain/model/aggregates/CaseRoutingRule.js';
import { generateCaseRoutingRuleId } from '../../../src/modules/case-management/domain/model/value-objects/CaseRoutingRuleId.js';
import { InMemoryCaseManagementAuditRecorder } from '../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';

jest.setTimeout(120_000);

const ORG = oid('org-1');
const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-02-01T00:00:00.000Z'));

const JDM: Readonly<Record<string, unknown>> = {
  contentType: 'application/vnd.gorules.decision',
  nodes: [{ id: 'n1', type: 'inputNode' }],
  edges: [],
};

function buildRule(status: 'ACTIVE' | 'INACTIVE', name: string): CaseRoutingRule {
  return CaseRoutingRule.create({
    id: generateCaseRoutingRuleId(),
    organizationId: ORG,
    name,
    conditions: JDM,
    conditionsVersion: 1,
    status,
    now: NOW,
  });
}

describe('ActivateRoutingRule with Mongo (non-exclusive)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoCaseRoutingRuleRepository;
  let unitOfWork: MongoUnitOfWork;

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

  beforeEach(() => {
    repository = new MongoCaseRoutingRuleRepository(db);
    unitOfWork = new MongoUnitOfWork(client);
  });

  afterEach(async () => {
    await db.collection('case_routing_rules').deleteMany({});
  });

  it('activates a draft while leaving sibling ACTIVE rules ACTIVE', async () => {
    const active = buildRule('ACTIVE', 'A');
    const draft = buildRule('INACTIVE', 'B');
    await repository.save(active);
    await repository.save(draft);

    const activate = createActivateRoutingRuleUseCase({
      routingRules: repository,
      auditRecorder: new InMemoryCaseManagementAuditRecorder(),
      unitOfWork,
      clock: { now: () => LATER },
    });

    const result = await activate({
      auth: createAuthContext({
        userId: oid('user-1'),
        organizationId: ORG,
        roleId: 'SUPERVISOR',
      }),
      ruleId: draft.id,
    });

    expect(result.status).toBe('ACTIVE');
    const activeRules = await repository.findActiveByOrganization(ORG);
    expect(activeRules).toHaveLength(2);
    expect(activeRules.map((r) => r.id).sort()).toEqual([active.id, draft.id].sort());
  });

  it('deactivates only the targeted ACTIVE rule in mongo', async () => {
    const first = buildRule('ACTIVE', 'A');
    const second = buildRule('ACTIVE', 'B');
    await repository.save(first);
    await repository.save(second);

    const deactivate = createDeactivateRoutingRuleUseCase({
      routingRules: repository,
      auditRecorder: new InMemoryCaseManagementAuditRecorder(),
      unitOfWork,
      clock: { now: () => LATER },
    });

    const result = await deactivate({
      auth: createAuthContext({
        userId: oid('user-1'),
        organizationId: ORG,
        roleId: 'ADMIN',
      }),
      ruleId: first.id,
    });

    expect(result.status).toBe('INACTIVE');
    const activeRules = await repository.findActiveByOrganization(ORG);
    expect(activeRules).toHaveLength(1);
    expect(activeRules[0]?.id).toBe(second.id);
    const loaded = await repository.findById(first.id);
    expect(loaded?.status).toBe('INACTIVE');
  });
});
