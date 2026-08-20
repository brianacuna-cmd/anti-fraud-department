import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { createAuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { MongoRiskScoringRuleRepository } from '../../../src/modules/risk-assessment/infrastructure/adapters/outbound/mongo/MongoRiskScoringRuleRepository.js';
import { MongoUnitOfWork } from '../../../src/modules/risk-assessment/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { createActivateScoringRuleUseCase } from '../../../src/modules/risk-assessment/application/ActivateScoringRule.js';
import { RiskScoringRule } from '../../../src/modules/risk-assessment/domain/model/aggregates/RiskScoringRule.js';
import { generateRiskScoringRuleId } from '../../../src/modules/risk-assessment/domain/model/value-objects/RiskScoringRuleId.js';
import { InMemoryRiskAssessmentAuditRecorder } from '../../helpers/risk-assessment/InMemoryRiskAssessmentAuditRecorder.js';

jest.setTimeout(120_000);

const ORG = oid('org-1');
const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-02-01T00:00:00.000Z'));

const JDM: Readonly<Record<string, unknown>> = {
  contentType: 'application/vnd.gorules.decision',
  nodes: [{ id: 'n1', type: 'inputNode' }],
  edges: [],
};

function buildRule(status: 'ACTIVE' | 'INACTIVE', name: string): RiskScoringRule {
  return RiskScoringRule.create({
    id: generateRiskScoringRuleId(),
    organizationId: ORG,
    name,
    conditions: JDM,
    conditionsVersion: 1,
    status,
    now: NOW,
  });
}

describe('ActivateScoringRule with MongoUnitOfWork (integration)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoRiskScoringRuleRepository;

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
    repository = new MongoRiskScoringRuleRepository(db);
  });

  afterEach(async () => {
    await db.collection('risk_scoring_rules').deleteMany({});
  });

  it('atomically swaps ACTIVE A → INACTIVE and draft B → ACTIVE', async () => {
    const active = buildRule('ACTIVE', 'A');
    const draft = buildRule('INACTIVE', 'B');
    await repository.save(active);
    await repository.save(draft);

    const activate = createActivateScoringRuleUseCase({
      scoringRules: repository,
      unitOfWork: new MongoUnitOfWork(client),
      auditRecorder: new InMemoryRiskAssessmentAuditRecorder(),
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
    expect(result.id).toBe(draft.id);

    const listed = await repository.listByOrganization(ORG);
    const byName = Object.fromEntries(listed.map((r) => [r.name, r.status]));
    expect(byName).toEqual({ A: 'INACTIVE', B: 'ACTIVE' });

    const actives = await repository.findActiveByOrganization(ORG);
    expect(actives).toHaveLength(1);
    expect(actives[0]?.name).toBe('B');
  });

  it('keeps at most one ACTIVE after sequential activates (unique index)', async () => {
    const first = buildRule('INACTIVE', 'first');
    const second = buildRule('INACTIVE', 'second');
    await repository.save(first);
    await repository.save(second);

    const activate = createActivateScoringRuleUseCase({
      scoringRules: repository,
      unitOfWork: new MongoUnitOfWork(client),
      auditRecorder: new InMemoryRiskAssessmentAuditRecorder(),
      clock: { now: () => LATER },
    });
    const auth = createAuthContext({
      userId: oid('user-1'),
      organizationId: ORG,
      roleId: 'ADMIN',
    });

    await activate({ auth, ruleId: first.id });
    await activate({ auth, ruleId: second.id });

    const actives = await repository.findActiveByOrganization(ORG);
    expect(actives).toHaveLength(1);
    expect(actives[0]?.name).toBe('second');
  });
});
