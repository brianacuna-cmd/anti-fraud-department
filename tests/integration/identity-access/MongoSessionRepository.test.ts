import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId, type Db, type MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoSessionRepository } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoSessionRepository.js';
import { MongoUnitOfWork } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { buildSession } from '../../helpers/identity-access/buildSession.js';
import { createSessionId } from '../../../src/modules/identity-access/domain/model/value-objects/SessionId.js';
import { createOrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import type { SessionDocument } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/documents/SessionDocument.js';

jest.setTimeout(120_000);

const LATER = fromDate(new Date('2026-01-01T00:10:00.000Z'));

describe('MongoSessionRepository (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoSessionRepository;

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
    repository = new MongoSessionRepository(db);
  });

  afterEach(async () => {
    await db.collection('sessions').deleteMany({});
  });

  it('persists a session and retrieves it by tokenHash', async () => {
    await repository.save(buildSession({ id: oid('session-1') }));

    const found = await repository.findByTokenHash(`token-hash-${oid('session-1')}`);

    expect(found?.id).toBe(oid('session-1'));
    expect(found?.userId).toBe(oid('user-1'));
    expect(found?.organizationId).toBe(oid('org-1'));
  });

  it('retrieves a session by id', async () => {
    await repository.save(buildSession({ id: oid('session-1') }));

    const found = await repository.findById(createSessionId(oid('session-1')));

    expect(found?.id).toBe(oid('session-1'));
  });

  it('returns null from findByTokenHash when nothing matches', async () => {
    expect(await repository.findByTokenHash(oid('missing'))).toBeNull();
  });

  it('rejects a duplicate TokenHash with a real E11000 (session_token_hash_unique)', async () => {
    await repository.save(buildSession({ id: oid('session-1'), tokenHash: 'dup-token' }));

    await expect(repository.save(buildSession({ id: oid('session-2'), tokenHash: 'dup-token' }))).rejects.toMatchObject({
      code: 11000,
    });
  });

  describe('revokeSession', () => {
    it('sets DeletedAt on exactly the given session id', async () => {
      await repository.save(buildSession({ id: oid('session-1') }));
      await repository.save(buildSession({ id: oid('session-2') }));

      await repository.revokeSession(createSessionId(oid('session-1')), LATER);

      expect((await repository.findById(createSessionId(oid('session-1'))))?.deletedAt).toBe(LATER);
      expect((await repository.findById(createSessionId(oid('session-2'))))?.deletedAt).toBeNull();
    });

    it('is a no-op for an unknown session id', async () => {
      await expect(repository.revokeSession(createSessionId(oid('missing')), LATER)).resolves.toBeUndefined();
    });
  });

  describe('revokeAllForOrganization', () => {
    it('revokes only sessions belonging to that organization, inside a given transaction', async () => {
      const unitOfWork = new MongoUnitOfWork(client);
      await repository.save(buildSession({ id: oid('session-1'), organizationId: oid('org-1') }));
      await repository.save(buildSession({ id: oid('session-2'), organizationId: oid('org-2') }));

      const count = await unitOfWork.withTransaction((tx) =>
        repository.revokeAllForOrganization(createOrganizationId(oid('org-1')), LATER, tx),
      );

      expect(count).toBe(1);
      expect((await repository.findById(createSessionId(oid('session-1'))))?.deletedAt).toBe(LATER);
      expect((await repository.findById(createSessionId(oid('session-2'))))?.deletedAt).toBeNull();
    });
  });

  describe('revokeAllForActor', () => {
    it('revokes every session for a USER actor by userId', async () => {
      await repository.save(buildSession({ id: oid('session-1'), userId: oid('user-1') }));
      await repository.save(buildSession({ id: oid('session-2'), userId: oid('user-2') }));

      const count = await repository.revokeAllForActor({ actorType: 'USER', userId: oid('user-1') }, LATER);

      expect(count).toBe(1);
      expect((await repository.findById(createSessionId(oid('session-1'))))?.deletedAt).toBe(LATER);
      expect((await repository.findById(createSessionId(oid('session-2'))))?.deletedAt).toBeNull();
    });

    it('revokes every session for an ORGANIZATION actor by organizationId', async () => {
      await repository.save(buildSession({ id: oid('session-1'), userId: null, organizationId: oid('org-1') }));
      await repository.save(buildSession({ id: oid('session-2'), userId: null, organizationId: oid('org-2') }));

      const count = await repository.revokeAllForActor(
        { actorType: 'ORGANIZATION', organizationId: createOrganizationId(oid('org-1')) },
        LATER,
      );

      expect(count).toBe(1);
      expect((await repository.findById(createSessionId(oid('session-1'))))?.deletedAt).toBe(LATER);
      expect((await repository.findById(createSessionId(oid('session-2'))))?.deletedAt).toBeNull();
    });

    it('revokes every session for a PLATFORM_ADMIN actor by adminOrganizationId', async () => {
      await repository.save(buildSession({ id: oid('session-1'), adminOrganizationId: oid('admin-1') }));
      await repository.save(buildSession({ id: oid('session-2'), adminOrganizationId: oid('admin-2') }));

      const count = await repository.revokeAllForActor(
        { actorType: 'PLATFORM_ADMIN', adminOrganizationId: oid('admin-1') },
        LATER,
      );

      expect(count).toBe(1);
      expect((await repository.findById(createSessionId(oid('session-1'))))?.deletedAt).toBe(LATER);
      expect((await repository.findById(createSessionId(oid('session-2'))))?.deletedAt).toBeNull();
    });
  });

  it('multiple PLATFORM_ADMIN sessions coexist (distinct token hashes)', async () => {
    await repository.save(buildSession({ id: oid('admin-session-1'), adminOrganizationId: oid('admin-1') }));
    await expect(
      repository.save(buildSession({ id: oid('admin-session-2'), adminOrganizationId: oid('admin-1') })),
    ).resolves.not.toThrow();
    await expect(
      repository.save(buildSession({ id: oid('admin-session-3'), adminOrganizationId: oid('admin-2') })),
    ).resolves.not.toThrow();

    const rawDocuments = await db
      .collection<SessionDocument>('sessions')
      .find({ admin_organization_id: { $ne: null } })
      .toArray();
    expect(rawDocuments).toHaveLength(3);
  });

  it('round-trips the raw document with BSON ObjectId _id and Date expira_en', async () => {
    await repository.save(buildSession({ id: oid('session-id-guard') }));

    const rawDocument = await db
      .collection<SessionDocument>('sessions')
      .findOne({ _id: new ObjectId(oid('session-id-guard')) });

    expect(rawDocument).not.toBeNull();
    expect(rawDocument?._id).toBeInstanceOf(ObjectId);
    expect(rawDocument?._id.toString()).toBe(oid('session-id-guard'));
    expect(rawDocument?.user_id).toBeInstanceOf(ObjectId);
    expect(rawDocument?.organization_id).toBeInstanceOf(ObjectId);
    expect(rawDocument?.expira_en).toBeInstanceOf(Date);
    expect(rawDocument?.created_at).toBeInstanceOf(Date);
    expect(rawDocument).not.toHaveProperty('family_expires_at');
  });
});
