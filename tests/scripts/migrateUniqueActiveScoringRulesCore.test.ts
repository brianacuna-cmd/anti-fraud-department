import { ObjectId, type Db, type MongoClient } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connectMongo } from '../../src/shared/persistence/mongo/connect.js';
import { startReplicaSetMongo } from '../helpers/mongoTestServer.js';
import {
  countOrgsWithMultipleActiveScoringRules,
  deactivateOlderActiveScoringRules,
  runMigrateUniqueActiveScoringRules,
} from '../../scripts/migrateUniqueActiveScoringRulesCore.js';

jest.setTimeout(120_000);

describe('migrateUniqueActiveScoringRulesCore', () => {
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

  beforeEach(async () => {
    const existing = await db.listCollections({ name: 'risk_scoring_rules' }).toArray();
    if (existing.length > 0) {
      await db.collection('risk_scoring_rules').drop();
    }
  });

  it('deactivates older ACTIVE duplicates, keeping newest by updated_at then _id', async () => {
    const organizationId = new ObjectId();
    const olderId = new ObjectId();
    const newerId = new ObjectId();
    // newerId is lexicographically larger when timestamps tie — insert older updated_at first.
    await db.collection('risk_scoring_rules').insertMany([
      {
        _id: olderId,
        organization_id: organizationId,
        name: 'older',
        conditions: {},
        conditions_version: 1,
        status: 'ACTIVE',
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        updated_at: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        _id: newerId,
        organization_id: organizationId,
        name: 'newer',
        conditions: {},
        conditions_version: 1,
        status: 'ACTIVE',
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        updated_at: new Date('2026-01-02T00:00:00.000Z'),
      },
    ]);

    const result = await deactivateOlderActiveScoringRules(db);

    expect(result.deactivatedCount).toBe(1);
    expect(await countOrgsWithMultipleActiveScoringRules(db)).toBe(0);

    const rows = await db
      .collection('risk_scoring_rules')
      .find({ organization_id: organizationId })
      .toArray();
    const byName = Object.fromEntries(rows.map((row) => [row.name, row.status]));
    expect(byName).toEqual({ older: 'INACTIVE', newer: 'ACTIVE' });
  });

  it('when updated_at ties, keeps the ACTIVE rule with the greater _id', async () => {
    const organizationId = new ObjectId();
    const lowId = ObjectId.createFromHexString('aaaaaaaaaaaaaaaaaaaaaaaa');
    const highId = ObjectId.createFromHexString('bbbbbbbbbbbbbbbbbbbbbbbb');
    const tied = new Date('2026-01-05T00:00:00.000Z');

    await db.collection('risk_scoring_rules').insertMany([
      {
        _id: lowId,
        organization_id: organizationId,
        name: 'low-id',
        conditions: {},
        conditions_version: 1,
        status: 'ACTIVE',
        created_at: tied,
        updated_at: tied,
      },
      {
        _id: highId,
        organization_id: organizationId,
        name: 'high-id',
        conditions: {},
        conditions_version: 1,
        status: 'ACTIVE',
        created_at: tied,
        updated_at: tied,
      },
    ]);

    const result = await deactivateOlderActiveScoringRules(db);

    expect(result.deactivatedCount).toBe(1);
    const active = await db.collection('risk_scoring_rules').findOne({
      organization_id: organizationId,
      status: 'ACTIVE',
    });
    expect(active?._id.toHexString()).toBe(highId.toHexString());
  });

  it('runMigrateUniqueActiveScoringRules deactivates duplicates then creates the unique partial index', async () => {
    const organizationId = new ObjectId();
    await db.collection('risk_scoring_rules').insertMany([
      {
        _id: new ObjectId(),
        organization_id: organizationId,
        name: 'keep',
        conditions: {},
        conditions_version: 1,
        status: 'ACTIVE',
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        updated_at: new Date('2026-01-03T00:00:00.000Z'),
      },
      {
        _id: new ObjectId(),
        organization_id: organizationId,
        name: 'drop',
        conditions: {},
        conditions_version: 1,
        status: 'ACTIVE',
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        updated_at: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    await runMigrateUniqueActiveScoringRules(db);

    expect(await countOrgsWithMultipleActiveScoringRules(db)).toBe(0);
    const indexes = await db.collection('risk_scoring_rules').indexes();
    const activeUnique = indexes.find((index) => index.name === 'risk_scoring_rules_org_active_unique');
    expect(activeUnique?.unique).toBe(true);
    expect(activeUnique?.partialFilterExpression).toEqual({ status: 'ACTIVE' });
    expect(indexes.find((index) => index.name === 'risk_scoring_rules_org_status_idx')).toBeUndefined();
  });
});
