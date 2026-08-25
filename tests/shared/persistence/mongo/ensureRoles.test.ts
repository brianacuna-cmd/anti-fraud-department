import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../../src/shared/persistence/mongo/connect.js';
import { ensureRoles } from '../../../../src/shared/persistence/mongo/ensureRoles.js';
import { startReplicaSetMongo } from '../../../helpers/mongoTestServer.js';
import { fromDate, toDate } from '../../../../src/shared/time/Instant.js';
import type { RoleDocument } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/documents/RoleDocument.js';

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
    for (const name of ['roles', 'rol']) {
      const existing = await db.listCollections({ name }).toArray();
      if (existing.length > 0) {
        await db.collection(name).drop();
      }
    }
  });

  it('seeds exactly the four fixed roles on a fresh database, all ACTIVE', async () => {
    await ensureRoles(db, NOW);

    const documents = await db.collection<RoleDocument>('roles').find().sort({ _id: 1 }).toArray();

    expect(documents.map((document) => document._id)).toEqual(['ADMIN', 'ANALYST', 'AUDITOR', 'SUPERVISOR']);
    for (const document of documents) {
      expect(document.status).toBe('ACTIVE');
      expect(document.deleted_at).toBeNull();
      expect(document.role_name.length).toBeGreaterThan(0);
    }
  });

  it('is idempotent — running it twice does not duplicate rows and keeps CreatedAt stable', async () => {
    await ensureRoles(db, NOW);
    const firstRun = await db.collection<RoleDocument>('roles').find().sort({ _id: 1 }).toArray();

    await ensureRoles(db, LATER);
    const secondRun = await db.collection<RoleDocument>('roles').find().sort({ _id: 1 }).toArray();

    expect(secondRun).toHaveLength(4);
    expect(secondRun.map((document) => document.created_at)).toEqual(firstRun.map((document) => document.created_at));
  });

  it('converges/self-heals a manually-flipped Status back to ACTIVE on re-run', async () => {
    await ensureRoles(db, NOW);
    await db.collection<RoleDocument>('roles').updateOne({ _id: 'SUPERVISOR' }, { $set: { status: 'INACTIVE' } });

    await ensureRoles(db, LATER);

    const supervisor = await db.collection<RoleDocument>('roles').findOne({ _id: 'SUPERVISOR' });
    expect(supervisor?.status).toBe('ACTIVE');
    expect(supervisor?.created_at).toEqual(toDate(NOW));
  });

  it('renames a legacy rol collection to roles and keeps catalog rows', async () => {
    await db.collection<RoleDocument>('rol').insertOne({
      _id: 'ADMIN',
      role_name: 'Administrator',
      status: 'ACTIVE',
      created_at: toDate(NOW),
      deleted_at: null,
    });

    await ensureRoles(db, LATER);

    expect(await db.listCollections({ name: 'rol' }).toArray()).toHaveLength(0);
    const documents = await db.collection<RoleDocument>('roles').find().sort({ _id: 1 }).toArray();
    expect(documents.map((document) => document._id)).toEqual(['ADMIN', 'ANALYST', 'AUDITOR', 'SUPERVISOR']);
    expect(documents.find((document) => document._id === 'ADMIN')?.created_at).toEqual(toDate(NOW));
  });
});
