import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../../src/shared/persistence/mongo/connect.js';
import { ensureRoles } from '../../../../src/shared/persistence/mongo/ensureRoles.js';
import { startReplicaSetMongo } from '../../../helpers/mongoTestServer.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import type { RolDocument } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/documents/RolDocument.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-01T01:00:00.000Z'));

describe('ensureRoles (integration, real Mongo)', () => {
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
    await db.collection('Rol').deleteMany({});
  });

  it('seeds exactly the four fixed roles on a fresh database, all ACTIVE', async () => {
    await ensureRoles(db, NOW);

    const documents = await db.collection<RolDocument>('Rol').find().sort({ _id: 1 }).toArray();

    expect(documents.map((document) => document._id)).toEqual(['ADMIN', 'ANALYST', 'AUDITOR', 'SUPERVISOR']);
    for (const document of documents) {
      expect(document.Status).toBe('ACTIVE');
      expect(document.DeletedAt).toBeNull();
      expect(document.RoleName.length).toBeGreaterThan(0);
    }
  });

  it('is idempotent — running it twice does not duplicate rows and keeps CreatedAt stable', async () => {
    await ensureRoles(db, NOW);
    const firstRun = await db.collection<RolDocument>('Rol').find().sort({ _id: 1 }).toArray();

    await ensureRoles(db, LATER);
    const secondRun = await db.collection<RolDocument>('Rol').find().sort({ _id: 1 }).toArray();

    expect(secondRun).toHaveLength(4);
    expect(secondRun.map((document) => document.CreatedAt)).toEqual(firstRun.map((document) => document.CreatedAt));
  });

  it('converges/self-heals a manually-flipped Status back to ACTIVE on re-run', async () => {
    await ensureRoles(db, NOW);
    await db.collection<RolDocument>('Rol').updateOne({ _id: 'SUPERVISOR' }, { $set: { Status: 'INACTIVE' } });

    await ensureRoles(db, LATER);

    const supervisor = await db.collection<RolDocument>('Rol').findOne({ _id: 'SUPERVISOR' });
    expect(supervisor?.Status).toBe('ACTIVE');
    expect(supervisor?.CreatedAt).toBe(NOW);
  });
});
