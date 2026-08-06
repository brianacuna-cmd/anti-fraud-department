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

  it('creates the required indexes on a fresh database, with PascalCase keys for Organizations/Users (design A2/A3) and camelCase for AdminOrganization (design D39)', async () => {
    await ensureIndexes(db);

    const organizationIndexes = await db.collection('Organizations').indexes();
    const userIndexes = await db.collection('Users').indexes();
    const adminOrganizationIndexes = await db.collection('adminOrganizations').indexes();

    const slugIndex = organizationIndexes.find((index) => index.name === 'slug_unique');
    expect(slugIndex).toBeDefined();
    expect(slugIndex?.key).toEqual({ Slug: 1 });
    expect(slugIndex?.unique).toBe(true);

    const userEmailIndex = userIndexes.find((index) => index.name === 'user_email_unique');
    expect(userEmailIndex).toBeDefined();
    expect(userEmailIndex?.key).toEqual({ OrganizationId: 1, Email: 1 });
    expect(userEmailIndex?.unique).toBe(true);

    const userStatusIndex = userIndexes.find((index) => index.name === 'user_status_idx');
    expect(userStatusIndex).toBeDefined();
    expect(userStatusIndex?.key).toEqual({ OrganizationId: 1, Status: 1 });

    const adminEmailIndex = adminOrganizationIndexes.find(
      (index) => index.name === 'admin_organization_email_unique',
    );
    expect(adminEmailIndex).toBeDefined();
    expect(adminEmailIndex?.key).toEqual({ email: 1 });
    expect(adminEmailIndex?.unique).toBe(true);

    const adminKeysKeyIdIndex = adminOrganizationIndexes.find(
      (index) => index.name === 'admin_organization_keys_key_id_idx',
    );
    expect(adminKeysKeyIdIndex).toBeDefined();
    expect(adminKeysKeyIdIndex?.key).toEqual({ 'keys.keyId': 1 });
  });

  it('is idempotent — running it twice does not throw or duplicate indexes', async () => {
    await ensureIndexes(db);
    await ensureIndexes(db);

    const userIndexes = await db.collection('Users').indexes();
    const matchingNames = userIndexes.filter((index) => index.name === 'user_email_unique');
    expect(matchingNames).toHaveLength(1);
  });
});
