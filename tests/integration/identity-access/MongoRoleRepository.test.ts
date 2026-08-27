import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureRoles } from '../../../src/shared/persistence/mongo/ensureRoles.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoRoleRepository } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoRoleRepository.js';
import { createRoleId } from '../../../src/modules/identity-access/domain/model/value-objects/RoleId.js';
import { fromDate, toDate } from '../../../src/shared/time/Instant.js';
import type { RoleDocument } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/documents/RoleDocument.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

describe('MongoRoleRepository (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoRoleRepository;

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
    await ensureRoles(db, NOW);
    repository = new MongoRoleRepository(db);
  });

  afterEach(async () => {
    for (const name of ['roles', 'rol']) {
      const existing = await db.listCollections({ name }).toArray();
      if (existing.length > 0) {
        await db.collection(name).drop();
      }
    }
  });

  it('findById returns a known seeded role', async () => {
    const found = await repository.findById(createRoleId('SUPERVISOR'));

    expect(found?.id).toBe('SUPERVISOR');
    expect(found?.status).toBe('ACTIVE');
  });

  it('findById returns null when the role is not in the catalog', async () => {
    await db.collection('roles').deleteMany({});

    const found = await repository.findById(createRoleId('SUPERVISOR'));

    expect(found).toBeNull();
  });

  it.each(['SUPERVISOR', 'ANALYST', 'AUDITOR'])('isAssignableToUser is true for the seeded, ACTIVE role "%s"', async (roleId) => {
    expect(await repository.isAssignableToUser(createRoleId(roleId))).toBe(true);
  });

  it('isAssignableToUser is false for ADMIN', async () => {
    expect(await repository.isAssignableToUser(createRoleId('ADMIN'))).toBe(false);
  });

  it('isAssignableToUser is false for an INACTIVE role', async () => {
    await db.collection<RoleDocument>('roles').updateOne({ _id: 'AUDITOR' }, { $set: { status: 'INACTIVE' } });

    expect(await repository.isAssignableToUser(createRoleId('AUDITOR'))).toBe(false);
  });

  it('isAssignableToUser is false for a soft-deleted role', async () => {
    await db.collection<RoleDocument>('roles').updateOne({ _id: 'AUDITOR' }, { $set: { deleted_at: toDate(NOW) } });

    expect(await repository.isAssignableToUser(createRoleId('AUDITOR'))).toBe(false);
  });
});
