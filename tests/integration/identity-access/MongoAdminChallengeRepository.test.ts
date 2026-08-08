import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoAdminChallengeRepository } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoAdminChallengeRepository.js';
import { MongoUnitOfWork } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import type { AdminChallengeRecord } from '../../../src/modules/identity-access/domain/ports/AdminChallengeStore.js';
import type { AdminChallengeDocument } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/documents/AdminChallengeDocument.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-01T00:05:00.000Z'));
const EXPIRY = fromDate(new Date('2026-01-01T00:05:00.000Z'));
const PAST_EXPIRY = fromDate(new Date('2025-12-31T23:59:00.000Z'));

function buildRecord(overrides: Partial<AdminChallengeRecord> & { challengeId: string }): AdminChallengeRecord {
  return {
    challengeId: overrides.challengeId,
    adminOrganizationId: overrides.adminOrganizationId ?? 'admin-org-1',
    challenge: overrides.challenge ?? 'challenge-secret-1',
    expiresAt: overrides.expiresAt ?? EXPIRY,
    now: overrides.now ?? NOW,
  };
}

describe('MongoAdminChallengeRepository (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoAdminChallengeRepository;

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
    repository = new MongoAdminChallengeRepository(db);
  });

  afterEach(async () => {
    await db.collection('AdminChallenges').deleteMany({});
  });

  it('appends a challenge record retrievable by challengeId (raw document check)', async () => {
    await repository.append(buildRecord({ challengeId: 'challenge-id-1' }));

    const raw = await db.collection<AdminChallengeDocument>('AdminChallenges').findOne({ _id: 'challenge-id-1' });

    expect(raw?._id).toBe('challenge-id-1');
    expect(raw?.AdminOrganizationId).toBe('admin-org-1');
    expect(raw?.Challenge).toBe('challenge-secret-1');
    expect(raw?.ConsumedAt).toBeNull();
    expect(raw?.ExpiresAtDate).toBeInstanceOf(Date);
  });

  it('rejects a duplicate challengeId with a real E11000 (design: _id enforces uniqueness)', async () => {
    await repository.append(buildRecord({ challengeId: 'dup-challenge-id' }));

    await expect(repository.append(buildRecord({ challengeId: 'dup-challenge-id' }))).rejects.toMatchObject({
      code: 11000,
    });
  });

  describe('consume (atomic CAS)', () => {
    it('returns true for the first caller and stamps ConsumedAt', async () => {
      await repository.append(buildRecord({ challengeId: 'challenge-id-1' }));

      const won = await repository.consume('challenge-id-1', NOW);

      expect(won).toBe(true);
      const raw = await db.collection<AdminChallengeDocument>('AdminChallenges').findOne({ _id: 'challenge-id-1' });
      expect(raw?.ConsumedAt).toBe(NOW);
    });

    it('returns false for a second call — the CAS loser (replay)', async () => {
      await repository.append(buildRecord({ challengeId: 'challenge-id-1' }));
      await repository.consume('challenge-id-1', NOW);

      const lost = await repository.consume('challenge-id-1', NOW);

      expect(lost).toBe(false);
    });

    it('returns false for an unknown challengeId', async () => {
      expect(await repository.consume('unknown-challenge-id', NOW)).toBe(false);
    });

    it('returns false for an expired challengeId', async () => {
      await repository.append(buildRecord({ challengeId: 'challenge-id-1', expiresAt: PAST_EXPIRY }));

      expect(await repository.consume('challenge-id-1', LATER)).toBe(false);
    });

    it('two concurrent consume calls on the same challengeId: exactly one wins', async () => {
      await repository.append(buildRecord({ challengeId: 'challenge-id-1' }));

      const [first, second] = await Promise.all([
        repository.consume('challenge-id-1', NOW),
        repository.consume('challenge-id-1', NOW),
      ]);

      expect([first, second].filter(Boolean)).toHaveLength(1);
    });

    it('consume participates in a transaction — rolled-back consume leaves the row unconsumed', async () => {
      const unitOfWork = new MongoUnitOfWork(client);
      await repository.append(buildRecord({ challengeId: 'challenge-id-1' }));

      await expect(
        unitOfWork.withTransaction(async (tx) => {
          const won = await repository.consume('challenge-id-1', NOW, tx);
          expect(won).toBe(true);
          throw new Error('force rollback');
        }),
      ).rejects.toThrow('force rollback');

      const raw = await db.collection<AdminChallengeDocument>('AdminChallenges').findOne({ _id: 'challenge-id-1' });
      expect(raw?.ConsumedAt).toBeNull();
    });
  });

  describe('findById', () => {
    it('returns the persisted record mapped back to domain shape', async () => {
      await repository.append(buildRecord({ challengeId: 'challenge-id-1', challenge: 'super-secret' }));

      const entry = await repository.findById('challenge-id-1');

      expect(entry).toMatchObject({
        challengeId: 'challenge-id-1',
        adminOrganizationId: 'admin-org-1',
        challenge: 'super-secret',
        consumedAt: null,
      });
    });

    it('returns null for an unknown challengeId', async () => {
      expect(await repository.findById('unknown-challenge-id')).toBeNull();
    });
  });

  /**
   * Regression guard for design decision A1: `_id` MUST stay lowercase and
   * `typeof 'string'` (design D37), never a driver-generated `ObjectId` —
   * identical guard to `MongoMfaChallengeRepository`'s.
   */
  it('round-trips the raw document by string _id (design A1/D37 regression guard)', async () => {
    await repository.append(buildRecord({ challengeId: 'challenge-id-guard' }));

    const raw = await db
      .collection<AdminChallengeDocument>('AdminChallenges')
      .findOne({ _id: 'challenge-id-guard' });

    expect(raw).not.toBeNull();
    expect(raw?._id).toBe('challenge-id-guard');
    expect(typeof raw?._id).toBe('string');
  });

  it('a TTL index exists on ExpiresAtDate (design: TTL, never on the ISO string field)', async () => {
    const indexes = await db.collection('AdminChallenges').indexes();

    const ttlIndex = indexes.find((index) => index.name === 'admin_challenge_expires_at_ttl_idx');

    expect(ttlIndex).toBeDefined();
    expect(ttlIndex?.key).toEqual({ ExpiresAtDate: 1 });
    expect(ttlIndex?.expireAfterSeconds).toBe(0);
  });
});
