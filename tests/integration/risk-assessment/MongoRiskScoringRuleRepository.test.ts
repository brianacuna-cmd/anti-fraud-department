import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoRiskScoringRuleRepository } from '../../../src/modules/risk-assessment/infrastructure/adapters/outbound/mongo/MongoRiskScoringRuleRepository.js';
import { RiskScoringRule } from '../../../src/modules/risk-assessment/domain/model/aggregates/RiskScoringRule.js';
import { generateRiskScoringRuleId } from '../../../src/modules/risk-assessment/domain/model/value-objects/RiskScoringRuleId.js';
import { toDocument } from '../../../src/modules/risk-assessment/infrastructure/adapters/outbound/mongo/mappers/RiskScoringRuleDocumentMapper.js';
import type { RiskScoringRuleDocument } from '../../../src/modules/risk-assessment/infrastructure/adapters/outbound/mongo/documents/RiskScoringRuleDocument.js';
import { fromDate } from '../../../src/shared/time/Instant.js';

jest.setTimeout(120_000);

const JDM_CONDITIONS: Readonly<Record<string, unknown>> = {
  contentType: 'application/vnd.gorules.decision',
  nodes: [
    {
      id: 'collect',
      type: 'decisionTableNode',
      content: { hitPolicy: 'collect', rules: [{ amountCents: 100 }] },
    },
  ],
  edges: [],
};

function buildRule(
  name: string,
  createdAt: string,
  overrides: { organizationId?: string; status?: 'ACTIVE' | 'INACTIVE'; conditions?: Readonly<Record<string, unknown>> } = {},
): RiskScoringRule {
  return RiskScoringRule.create({
    id: generateRiskScoringRuleId(),
    organizationId: overrides.organizationId ?? oid('org-1'),
    name,
    conditions: overrides.conditions ?? JDM_CONDITIONS,
    conditionsVersion: 1,
    status: overrides.status ?? 'ACTIVE',
    now: fromDate(new Date(createdAt)),
  });
}

async function seed(db: Db, rule: RiskScoringRule): Promise<void> {
  await db.collection<RiskScoringRuleDocument>('risk_scoring_rules').insertOne(toDocument(rule));
}

describe('MongoRiskScoringRuleRepository (integration, real replica-set Mongo)', () => {
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

  it('returns the sole ACTIVE rule for the given organization (unique ACTIVE per org)', async () => {
    await seed(db, buildRule('active', '2026-01-02T00:00:00.000Z'));
    await seed(db, buildRule('inactive', '2026-01-03T00:00:00.000Z', { status: 'INACTIVE' }));
    await seed(db, buildRule('other-org', '2026-01-01T00:00:00.000Z', { organizationId: oid('org-2') }));

    const rules = await repository.findActiveByOrganization(oid('org-1'));

    expect(rules.map((r) => r.name)).toEqual(['active']);
  });

  it('returns an empty array when the organization has no active rules', async () => {
    await seed(db, buildRule('inactive', '2026-01-01T00:00:00.000Z', { status: 'INACTIVE' }));

    const rules = await repository.findActiveByOrganization(oid('org-1'));

    expect(rules).toEqual([]);
  });

  it('persists JDM conditions in camelCase (does not snake_case keys inside the blob)', async () => {
    await seed(db, buildRule('graph', '2026-01-01T00:00:00.000Z'));

    const stored = await db.collection<RiskScoringRuleDocument>('risk_scoring_rules').findOne({ name: 'graph' });
    expect(stored?.conditions).toEqual(JDM_CONDITIONS);
    expect(JSON.stringify(stored?.conditions)).toContain('amountCents');
    expect(JSON.stringify(stored?.conditions)).toContain('hitPolicy');
    expect(JSON.stringify(stored?.conditions)).not.toContain('amount_cents');

    const [rule] = await repository.findActiveByOrganization(oid('org-1'));
    expect(rule.conditions).toEqual(JDM_CONDITIONS);
  });

  it('save / findById / listByOrganization round-trip ACTIVE and INACTIVE', async () => {
    const active = buildRule('active', '2026-01-02T00:00:00.000Z');
    const draft = buildRule('draft', '2026-01-03T00:00:00.000Z', { status: 'INACTIVE' });

    await repository.save(active);
    await repository.save(draft);

    const found = await repository.findById(draft.id);
    expect(found?.name).toBe('draft');
    expect(found?.status).toBe('INACTIVE');

    const listed = await repository.listByOrganization(oid('org-1'));
    expect(listed.map((r) => r.name)).toEqual(['active', 'draft']);
  });
});
