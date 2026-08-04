import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../../helpers/mongoTestServer.js';

jest.setTimeout(120_000);

describe('ensureIndexes (integration, real Mongo)', () => {
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

  it('creates the three required indexes on a fresh database', async () => {
    await ensureIndexes(db);

    const organizationIndexes = await db.collection('organizations').indexes();
    const userIndexes = await db.collection('users').indexes();

    const slugIndex = organizationIndexes.find((index) => index.name === 'slug_unique');
    expect(slugIndex).toBeDefined();
    expect(slugIndex?.key).toEqual({ slug: 1 });
    expect(slugIndex?.unique).toBe(true);

    const userEmailIndex = userIndexes.find((index) => index.name === 'user_email_unique');
    expect(userEmailIndex).toBeDefined();
    expect(userEmailIndex?.key).toEqual({ organizationId: 1, email: 1 });
    expect(userEmailIndex?.unique).toBe(true);

    const userStatusIndex = userIndexes.find((index) => index.name === 'user_status_idx');
    expect(userStatusIndex).toBeDefined();
    expect(userStatusIndex?.key).toEqual({ organizationId: 1, status: 1 });
  });

  it('is idempotent — running it twice does not throw or duplicate indexes', async () => {
    await ensureIndexes(db);
    await ensureIndexes(db);

    const userIndexes = await db.collection('users').indexes();
    const matchingNames = userIndexes.filter((index) => index.name === 'user_email_unique');
    expect(matchingNames).toHaveLength(1);
  });
});
