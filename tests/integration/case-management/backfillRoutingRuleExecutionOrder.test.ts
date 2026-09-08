import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId, type Db, type MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { backfillRoutingRuleExecutionOrder } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/backfillRoutingRuleExecutionOrder.js';

jest.setTimeout(120_000);

const ORG_1 = new ObjectId(oid('org-1'));
const ORG_2 = new ObjectId(oid('org-2'));
const UPDATED = new Date('2026-03-01T00:00:00.000Z');

async function insertLegacy(
  db: Db,
  name: string,
  organizationId: ObjectId,
  createdAt: string,
  extras: { execution_order?: number } = {},
): Promise<ObjectId> {
  const _id = new ObjectId();
  await db.collection('case_routing_rules').insertOne({
    _id,
    organization_id: organizationId,
    name,
    conditions: { nodes: [] },
    conditions_version: 1,
    target_role_id: null,
    target_user_id: null,
    status: 'ACTIVE',
    created_at: new Date(createdAt),
    updated_at: UPDATED,
    ...extras,
  });
  return _id;
}

describe('backfillRoutingRuleExecutionOrder', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    replicaSet = await startReplicaSetMongo();
    const connection = await connectMongo(replicaSet.getUri(), 'anti_fraud_test');
    client = connection.client;
    db = connection.db;
  });

  afterAll(async () => {
    await client.close();
    await replicaSet.stop();
  });

  afterEach(async () => {
    await db.collection('case_routing_rules').deleteMany({});
  });

  it('assigns 0..n-1 per organization by created_at ASC and does not bump updated_at', async () => {
    await insertLegacy(db, 'org1-second', ORG_1, '2026-01-02T00:00:00.000Z');
    await insertLegacy(db, 'org1-first', ORG_1, '2026-01-01T00:00:00.000Z');
    await insertLegacy(db, 'org2-only', ORG_2, '2026-01-03T00:00:00.000Z');

    await backfillRoutingRuleExecutionOrder(db);

    const org1 = await db
      .collection('case_routing_rules')
      .find({ organization_id: ORG_1 })
      .sort({ created_at: 1 })
      .toArray();
    expect(org1.map((doc) => doc.name)).toEqual(['org1-first', 'org1-second']);
    expect(org1.map((doc) => doc.execution_order)).toEqual([0, 1]);
    expect(org1.every((doc) => doc.updated_at.getTime() === UPDATED.getTime())).toBe(true);

    const org2 = await db.collection('case_routing_rules').find({ organization_id: ORG_2 }).toArray();
    expect(org2).toHaveLength(1);
    expect(org2[0]?.execution_order).toBe(0);
    expect(org2[0]?.updated_at.getTime()).toBe(UPDATED.getTime());
  });

  it('is idempotent and leaves rows that already have execution_order unchanged', async () => {
    const keptId = await insertLegacy(db, 'already-set', ORG_1, '2026-01-01T00:00:00.000Z', {
      execution_order: 9,
    });
    await insertLegacy(db, 'missing', ORG_1, '2026-01-02T00:00:00.000Z');

    await backfillRoutingRuleExecutionOrder(db);
    await backfillRoutingRuleExecutionOrder(db);

    const kept = await db.collection('case_routing_rules').findOne({ _id: keptId });
    expect(kept?.execution_order).toBe(9);
    expect(kept?.updated_at.getTime()).toBe(UPDATED.getTime());

    const missing = await db.collection('case_routing_rules').findOne({ name: 'missing' });
    expect(missing?.execution_order).toBe(0);
    expect(missing?.updated_at.getTime()).toBe(UPDATED.getTime());
  });
});
