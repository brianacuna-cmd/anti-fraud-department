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
  overrides: { organizationId?: string; status?: 'ACTIVE' | 'INACTIVE'; executionOrder?: number } = {},
): CaseRoutingRule {
  return CaseRoutingRule.create({
    id: generateCaseRoutingRuleId(),
    organizationId: overrides.organizationId ?? oid('org-1'),
    name,
    conditions: { contentType: 'application/vnd.gorules.decision', nodes: [], edges: [] },
    conditionsVersion: 1,
    status: overrides.status ?? 'ACTIVE',
    executionOrder: overrides.executionOrder,
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

  it('save/findById/listByOrganization round-trip ACTIVE and INACTIVE drafts', async () => {
    const active = buildRule('live', '2026-01-01T00:00:00.000Z', { status: 'ACTIVE' });
    const draft = buildRule('draft', '2026-01-02T00:00:00.000Z', { status: 'INACTIVE' });
    const otherOrg = buildRule('other', '2026-01-01T00:00:00.000Z', {
      organizationId: oid('org-2'),
      status: 'INACTIVE',
    });

    await repository.save(active);
    await repository.save(draft);
    await repository.save(otherOrg);

    const found = await repository.findById(draft.id);
    expect(found).not.toBeNull();
    expect(found?.name).toBe('draft');
    expect(found?.status).toBe('INACTIVE');

    const listed = await repository.listByOrganization(oid('org-1'));
    expect(listed.map((r) => r.name)).toEqual(['live', 'draft']);
  });

  it('sorts findActive and list by execution_order ASC then created_at ASC', async () => {
    await seed(db, buildRule('later-created-first-order', '2026-01-03T00:00:00.000Z', { executionOrder: 0 }));
    await seed(db, buildRule('earlier-created-second-order', '2026-01-01T00:00:00.000Z', { executionOrder: 1 }));
    await seed(
      db,
      buildRule('same-order-later', '2026-01-05T00:00:00.000Z', { executionOrder: 1 }),
    );
    await seed(db, buildRule('inactive', '2026-01-01T00:00:00.000Z', { status: 'INACTIVE', executionOrder: 0 }));

    const active = await repository.findActiveByOrganization(oid('org-1'));
    expect(active.map((r) => r.name)).toEqual([
      'later-created-first-order',
      'earlier-created-second-order',
      'same-order-later',
    ]);

    const listed = await repository.listByOrganization(oid('org-1'));
    expect(listed.map((r) => r.name)).toEqual([
      'inactive',
      'later-created-first-order',
      'earlier-created-second-order',
      'same-order-later',
    ]);
  });

  it('orders documents missing execution_order the same as CreatedAt ASC (backfill-equivalent)', async () => {
    const first = buildRule('first', '2026-01-01T00:00:00.000Z');
    const second = buildRule('second', '2026-01-02T00:00:00.000Z');
    const firstDoc = toDocument(first);
    const secondDoc = toDocument(second);
    const { execution_order: _firstOrder, ...firstLegacy } = firstDoc;
    const { execution_order: _secondOrder, ...secondLegacy } = secondDoc;
    void _firstOrder;
    void _secondOrder;
    await db.collection('case_routing_rules').insertOne(firstLegacy);
    await db.collection('case_routing_rules').insertOne(secondLegacy);

    const active = await repository.findActiveByOrganization(oid('org-1'));
    expect(active.map((r) => r.name)).toEqual(['first', 'second']);
  });
});
