import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId, type Db, type MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoSessionRepository } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoSessionRepository.js';
import { MongoUnitOfWork } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { Session } from '../../../src/modules/identity-access/domain/model/aggregates/Session.js';
import { createSessionId } from '../../../src/modules/identity-access/domain/model/value-objects/SessionId.js';
import { createFamilyId } from '../../../src/modules/identity-access/domain/model/value-objects/FamilyId.js';
import { createOrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import type { SessionDocument } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/documents/SessionDocument.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-01T00:10:00.000Z'));

function buildSession(overrides: {
  id: string;
  familyId?: string;
  userId?: string | null;
  organizationId?: string | null;
  actorType?: 'USER' | 'ORGANIZATION' | 'PLATFORM_ADMIN';
  tokenHash?: string;
  refreshTokenHash?: string | null;
}): Session {
  return Session.create({
    id: createSessionId(overrides.id),
    userId: overrides.userId === undefined ? oid('user-1') : overrides.userId,
    organizationId:
      overrides.organizationId === undefined
        ? createOrganizationId(oid('org-1'))
        : overrides.organizationId === null
          ? null
          : createOrganizationId(overrides.organizationId),
    actorType: overrides.actorType ?? 'USER',
    tokenHash: overrides.tokenHash ?? `token-hash-${overrides.id}`,
    refreshTokenHash:
      overrides.refreshTokenHash === undefined ? `refresh-hash-${overrides.id}` : overrides.refreshTokenHash,
    expiresAt: NOW,
    refreshExpiresAt: LATER,
    familyId: createFamilyId(overrides.familyId ?? oid('family-1')),
    familyExpiresAt: LATER,
    now: NOW,
  });
}

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

  it('returns null from findByTokenHash when nothing matches', async () => {
    expect(await repository.findByTokenHash(oid('missing'))).toBeNull();
  });

  it('retrieves a session by refreshTokenHash', async () => {
    await repository.save(buildSession({ id: oid('session-1') }));

    const found = await repository.findByRefreshTokenHash(`refresh-hash-${oid('session-1')}`);

    expect(found?.id).toBe(oid('session-1'));
  });

  it('rejects a duplicate real TokenHash with a real E11000 (session_token_hash_unique)', async () => {
    await repository.save(buildSession({ id: oid('session-1'), tokenHash: 'dup-token' }));

    await expect(repository.save(buildSession({ id: oid('session-2'), tokenHash: 'dup-token' }))).rejects.toMatchObject({
      code: 11000,
    });
  });

  describe('markRotated (design D15 — atomic CAS)', () => {
    it('returns true for the first caller and stamps RotatedAt', async () => {
      await repository.save(buildSession({ id: oid('session-1') }));

      const won = await repository.markRotated(createSessionId(oid('session-1')), LATER);

      expect(won).toBe(true);
      const found = await repository.findByTokenHash(`token-hash-${oid('session-1')}`);
      expect(found?.rotatedAt).toBe(LATER);
    });

    it('returns false for a second call — the CAS loser', async () => {
      await repository.save(buildSession({ id: oid('session-1') }));
      await repository.markRotated(createSessionId(oid('session-1')), LATER);

      const lost = await repository.markRotated(createSessionId(oid('session-1')), LATER);

      expect(lost).toBe(false);
    });

    it('two concurrent markRotated calls on the same not-yet-rotated session: exactly one wins', async () => {
      await repository.save(buildSession({ id: oid('session-1') }));

      const [first, second] = await Promise.all([
        repository.markRotated(createSessionId(oid('session-1')), LATER),
        repository.markRotated(createSessionId(oid('session-1')), LATER),
      ]);

      expect([first, second].filter(Boolean)).toHaveLength(1);
    });
  });

  describe('revokeFamily', () => {
    it('revokes every session sharing familyId and returns the count', async () => {
      await repository.save(buildSession({ id: oid('session-1'), familyId: oid('family-1') }));
      await repository.save(buildSession({ id: oid('session-2'), familyId: oid('family-1') }));
      await repository.save(buildSession({ id: oid('session-3'), familyId: oid('family-2') }));

      const count = await repository.revokeFamily(createFamilyId(oid('family-1')), LATER);

      expect(count).toBe(2);
      expect((await repository.findByTokenHash(`token-hash-${oid('session-1')}`))?.deletedAt).toBe(LATER);
      expect((await repository.findByTokenHash(`token-hash-${oid('session-2')}`))?.deletedAt).toBe(LATER);
      expect((await repository.findByTokenHash(`token-hash-${oid('session-3')}`))?.deletedAt).toBeNull();
    });
  });

  describe('revokeSession (Phase 4 — Logout)', () => {
    it('sets DeletedAt on exactly the given session id', async () => {
      await repository.save(buildSession({ id: oid('session-1') }));
      await repository.save(buildSession({ id: oid('session-2') }));

      await repository.revokeSession(createSessionId(oid('session-1')), LATER);

      expect((await repository.findByTokenHash(`token-hash-${oid('session-1')}`))?.deletedAt).toBe(LATER);
      expect((await repository.findByTokenHash(`token-hash-${oid('session-2')}`))?.deletedAt).toBeNull();
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
      expect((await repository.findByTokenHash(`token-hash-${oid('session-1')}`))?.deletedAt).toBe(LATER);
      expect((await repository.findByTokenHash(`token-hash-${oid('session-2')}`))?.deletedAt).toBeNull();
    });
  });

  describe('revokeAllForActor', () => {
    it('revokes every session for a USER actor by userId', async () => {
      await repository.save(buildSession({ id: oid('session-1'), userId: oid('user-1') }));
      await repository.save(buildSession({ id: oid('session-2'), userId: oid('user-2') }));

      const count = await repository.revokeAllForActor({ actorType: 'USER', userId: oid('user-1') }, LATER);

      expect(count).toBe(1);
      expect((await repository.findByTokenHash(`token-hash-${oid('session-1')}`))?.deletedAt).toBe(LATER);
      expect((await repository.findByTokenHash(`token-hash-${oid('session-2')}`))?.deletedAt).toBeNull();
    });

    it('revokes every session for an ORGANIZATION actor by organizationId', async () => {
      await repository.save(
        buildSession({ id: oid('session-1'), userId: null, organizationId: oid('org-1'), actorType: 'ORGANIZATION' }),
      );
      await repository.save(
        buildSession({ id: oid('session-2'), userId: null, organizationId: oid('org-2'), actorType: 'ORGANIZATION' }),
      );

      const count = await repository.revokeAllForActor(
        { actorType: 'ORGANIZATION', organizationId: createOrganizationId(oid('org-1')) },
        LATER,
      );

      expect(count).toBe(1);
      expect((await repository.findByTokenHash(`token-hash-${oid('session-1')}`))?.deletedAt).toBe(LATER);
      expect((await repository.findByTokenHash(`token-hash-${oid('session-2')}`))?.deletedAt).toBeNull();
    });
  });

  /**
   * D38 regression guard (task 3b.8) — the exact scenario a PLAIN or a
   * SPARSE unique index on `RefreshTokenHash` gets wrong: MULTIPLE rows with
   * a null `RefreshTokenHash` must coexist. `PLATFORM_ADMIN` is the
   * refresh-less tier (design D38) that makes this real, even though this
   * change mints no PLATFORM_ADMIN session itself — `identity-access-super-
   * admin-auth` depends on this exact index behavior.
   */
  it('two PLATFORM_ADMIN-shaped sessions with a null RefreshTokenHash coexist with no E11000, and a third still inserts (design D38)', async () => {
    await repository.save(
      buildSession({
        id: oid('admin-session-1'),
        userId: oid('admin-1'),
        organizationId: null,
        actorType: 'PLATFORM_ADMIN',
        refreshTokenHash: null,
      }),
    );

    await expect(
      repository.save(
        buildSession({
          id: oid('admin-session-2'),
          userId: oid('admin-2'),
          organizationId: null,
          actorType: 'PLATFORM_ADMIN',
          refreshTokenHash: null,
        }),
      ),
    ).resolves.not.toThrow();

    await expect(
      repository.save(
        buildSession({
          id: oid('admin-session-3'),
          userId: oid('admin-3'),
          organizationId: null,
          actorType: 'PLATFORM_ADMIN',
          refreshTokenHash: null,
        }),
      ),
    ).resolves.not.toThrow();

    const rawDocuments = await db
      .collection<SessionDocument>('sessions')
      .find({ actor_type: 'PLATFORM_ADMIN' })
      .toArray();
    expect(rawDocuments).toHaveLength(3);
    expect(rawDocuments.every((document) => document.refresh_token_hash === null)).toBe(true);
  });

  it('still rejects a real duplicate (non-null) RefreshTokenHash with E11000 (design D38 — index still functions for real duplicates)', async () => {
    await repository.save(buildSession({ id: oid('session-1'), refreshTokenHash: 'dup-refresh' }));

    await expect(
      repository.save(buildSession({ id: oid('session-2'), refreshTokenHash: 'dup-refresh' })),
    ).rejects.toMatchObject({ code: 11000 });
  });

  /**
   * Regression guard for design decision A1: `_id` MUST stay lowercase, the
   * single documented exception to the otherwise-PascalCase persistence
   * shape, and every new collection's raw `_id` must be `typeof 'string'`
   * (design D37), never a driver-generated `ObjectId`.
   */
  it('round-trips the raw document by string _id (design A1/D37 regression guard)', async () => {
    await repository.save(buildSession({ id: oid('session-id-guard') }));

    const rawDocument = await db.collection<SessionDocument>('sessions').findOne({ _id: new ObjectId(oid('session-id-guard')) });

    expect(rawDocument).not.toBeNull();
    expect(rawDocument?._id).toBeInstanceOf(ObjectId);
    expect(rawDocument?._id.toString()).toBe(oid('session-id-guard'));
    expect(rawDocument?.family_expires_at).toBeInstanceOf(Date);
  });
});
