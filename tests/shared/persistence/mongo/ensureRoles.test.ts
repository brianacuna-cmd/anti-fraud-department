import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../../src/shared/persistence/mongo/connect.js';
import { ensureRoles } from '../../../../src/shared/persistence/mongo/ensureRoles.js';
import { startReplicaSetMongo } from '../../../helpers/mongoTestServer.js';
import { fromDate, toDate } from '../../../../src/shared/time/Instant.js';
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
    await db.collection('rol').deleteMany({});
  });

  it('seeds exactly the four fixed roles on a fresh database, all ACTIVE', async () => {
    await ensureRoles(db, NOW);

    const documents = await db.collection<RolDocument>('rol').find().sort({ _id: 1 }).toArray();

    expect(documents.map((document) => document._id)).toEqual(['ADMIN', 'ANALYST', 'AUDITOR', 'SUPERVISOR']);
    for (const document of documents) {
      expect(document.status).toBe('ACTIVE');
      expect(document.deleted_at).toBeNull();
      expect(document.role_name.length).toBeGreaterThan(0);
    }
  });

  it('is idempotent — running it twice does not duplicate rows and keeps CreatedAt stable', async () => {
    await ensureRoles(db, NOW);
    const firstRun = await db.collection<RolDocument>('rol').find().sort({ _id: 1 }).toArray();

    await ensureRoles(db, LATER);
    const secondRun = await db.collection<RolDocument>('rol').find().sort({ _id: 1 }).toArray();

    expect(secondRun).toHaveLength(4);
    expect(secondRun.map((document) => document.created_at)).toEqual(firstRun.map((document) => document.created_at));
  });

  it('converges/self-heals a manually-flipped Status back to ACTIVE on re-run', async () => {
    await ensureRoles(db, NOW);
    await db.collection<RolDocument>('rol').updateOne({ _id: 'SUPERVISOR' }, { $set: { status: 'INACTIVE' } });

    await ensureRoles(db, LATER);

    const supervisor = await db.collection<RolDocument>('rol').findOne({ _id: 'SUPERVISOR' });
    expect(supervisor?.status).toBe('ACTIVE');
    expect(supervisor?.created_at).toEqual(toDate(NOW));
  });
});
