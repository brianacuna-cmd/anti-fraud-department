import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoCaseRoutingRuleRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoCaseRoutingRuleRepository.js';
import { CaseRoutingRule } from '../../../src/modules/case-management/domain/model/aggregates/CaseRoutingRule.js';
import { generateCaseRoutingRuleId } from '../../../src/modules/case-management/domain/model/value-objects/CaseRoutingRuleId.js';
import { toDocument } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/mappers/CaseRoutingRuleDocumentMapper.js';
import type { CaseRoutingRuleDocument } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/documents/CaseRoutingRuleDocument.js';
import { fromDate } from '../../../src/shared/time/Instant.js';

jest.setTimeout(120_000);

function buildRule(
  name: string,
  createdAt: string,
  overrides: { organizationId?: string; status?: 'ACTIVE' | 'INACTIVE' } = {},
): CaseRoutingRule {
  return CaseRoutingRule.create({
    id: generateCaseRoutingRuleId(),
    organizationId: overrides.organizationId ?? oid('org-1'),
    name,
    conditions: { contentType: 'application/vnd.gorules.decision', nodes: [], edges: [] },
    conditionsVersion: 1,
    status: overrides.status ?? 'ACTIVE',
    now: fromDate(new Date(createdAt)),
  });
}

async function seed(db: Db, rule: CaseRoutingRule): Promise<void> {
  await db.collection<CaseRoutingRuleDocument>('case_routing_rules').insertOne(toDocument(rule));
}

describe('MongoCaseRoutingRuleRepository (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoCaseRoutingRuleRepository;

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
  });

  afterEach(async () => {
    await db.collection('case_routing_rules').deleteMany({});
  });

  it('returns only ACTIVE rules for the given organization, ordered by CreatedAt ascending', async () => {
    await seed(db, buildRule('second', '2026-01-02T00:00:00.000Z'));
    await seed(db, buildRule('first', '2026-01-01T00:00:00.000Z'));
    await seed(db, buildRule('inactive', '2026-01-03T00:00:00.000Z', { status: 'INACTIVE' }));
    await seed(db, buildRule('other-org', '2026-01-01T00:00:00.000Z', { organizationId: oid('org-2') }));

    const rules = await repository.findActiveByOrganization(oid('org-1'));

    expect(rules.map((r) => r.name)).toEqual(['first', 'second']);
  });

  it('returns an empty array when the organization has no active rules', async () => {
    await seed(db, buildRule('inactive', '2026-01-01T00:00:00.000Z', { status: 'INACTIVE' }));

    const rules = await repository.findActiveByOrganization(oid('org-1'));

    expect(rules).toEqual([]);
  });
});
