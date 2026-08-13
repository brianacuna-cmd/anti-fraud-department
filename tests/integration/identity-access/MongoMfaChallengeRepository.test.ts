import { oid } from '../../support/oid.js';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId, type Db, type MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoMfaChallengeRepository } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoMfaChallengeRepository.js';
import { MongoUnitOfWork } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { fromDate, toDate } from '../../../src/shared/time/Instant.js';
import type { MfaChallengeRecord } from '../../../src/modules/identity-access/domain/ports/MfaChallengeStore.js';
import type { MfaChallengeDocument } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/documents/MfaChallengeDocument.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-01T00:05:00.000Z'));
const EXPIRY = fromDate(new Date('2026-01-01T00:05:00.000Z'));
const PAST_EXPIRY = fromDate(new Date('2025-12-31T23:59:00.000Z'));

function buildRecord(overrides: Partial<MfaChallengeRecord> & { jti: string }): MfaChallengeRecord {
  return {
    jti: overrides.jti,
    userId: overrides.userId ?? oid('user-1'),
    organizationId: overrides.organizationId ?? oid('org-1'),
    actorType: 'USER',
    tokenType: overrides.tokenType ?? 'mfa_challenge',
    expiresAt: overrides.expiresAt ?? EXPIRY,
    now: overrides.now ?? NOW,
  };
}

describe('MongoMfaChallengeRepository (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoMfaChallengeRepository;

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
    repository = new MongoMfaChallengeRepository(db);
  });

  afterEach(async () => {
    await db.collection('mfa_challenges').deleteMany({});
  });

  it('appends a challenge record retrievable by jti (raw document check)', async () => {
    await repository.append(buildRecord({ jti: 'jti-1' }));

    const raw = await db.collection<MfaChallengeDocument>('mfa_challenges').findOne({ _id: 'jti-1' });

    expect(raw?._id).toBe('jti-1');
    expect(raw?.user_id).toEqual(new ObjectId(oid('user-1')));
    expect(raw?.organization_id).toEqual(new ObjectId(oid('org-1')));
    expect(raw?.actor_type).toBe('USER');
    expect(raw?.token_type).toBe('mfa_challenge');
    expect(raw?.consumed_at).toBeNull();
    expect(raw?.expires_at).toBeInstanceOf(Date);
  });

  it('rejects a duplicate jti with a real E11000 (design: _id enforces uniqueness)', async () => {
    await repository.append(buildRecord({ jti: 'dup-jti' }));

    await expect(repository.append(buildRecord({ jti: 'dup-jti' }))).rejects.toMatchObject({ code: 11000 });
  });

  describe('consume (design D1 — atomic CAS)', () => {
    it('returns true for the first caller and stamps ConsumedAt', async () => {
      await repository.append(buildRecord({ jti: 'jti-1' }));

      const won = await repository.consume('jti-1', NOW);

      expect(won).toBe(true);
      const raw = await db.collection<MfaChallengeDocument>('mfa_challenges').findOne({ _id: 'jti-1' });
      expect(raw?.consumed_at).toEqual(toDate(NOW));
    });

    it('returns false for a second call — the CAS loser (replay)', async () => {
      await repository.append(buildRecord({ jti: 'jti-1' }));
      await repository.consume('jti-1', NOW);

      const lost = await repository.consume('jti-1', NOW);

      expect(lost).toBe(false);
    });

    it('returns false for an unknown jti', async () => {
      expect(await repository.consume('unknown-jti', NOW)).toBe(false);
    });

    it('returns false for an expired jti', async () => {
      await repository.append(buildRecord({ jti: 'jti-1', expiresAt: PAST_EXPIRY }));

      expect(await repository.consume('jti-1', LATER)).toBe(false);
    });

    /**
     * The exact replay-safety scenario the design's atomic CAS exists to
     * close (task 1a.7): two concurrent `consume` calls for the SAME jti —
     * only one may ever win, mirroring `MongoSessionRepository.markRotated`'s
     * identical concurrent test.
     */
    it('two concurrent consume calls on the same jti: exactly one wins', async () => {
      await repository.append(buildRecord({ jti: 'jti-1' }));

      const [first, second] = await Promise.all([
        repository.consume('jti-1', NOW),
        repository.consume('jti-1', NOW),
      ]);

      expect([first, second].filter(Boolean)).toHaveLength(1);
    });

    it('consume participates in a transaction — rolled-back consume leaves the row unconsumed', async () => {
      const unitOfWork = new MongoUnitOfWork(client);
      await repository.append(buildRecord({ jti: 'jti-1' }));

      await expect(
        unitOfWork.withTransaction(async (tx) => {
          const won = await repository.consume('jti-1', NOW, tx);
          expect(won).toBe(true);
          throw new Error('force rollback');
        }),
      ).rejects.toThrow('force rollback');

      const raw = await db.collection<MfaChallengeDocument>('mfa_challenges').findOne({ _id: 'jti-1' });
      expect(raw?.consumed_at).toBeNull();
    });
  });

  /**
   * Regression guard for design decision A1: `_id` MUST stay lowercase and
   * `typeof 'string'` (design D37), never a driver-generated `ObjectId` —
   * identical guard to `MongoSessionRepository`'s.
   */
  it('round-trips the raw document by string _id (design A1/D37 regression guard)', async () => {
    await repository.append(buildRecord({ jti: 'jti-id-guard' }));

    const raw = await db.collection<MfaChallengeDocument>('mfa_challenges').findOne({ _id: 'jti-id-guard' });

    expect(raw).not.toBeNull();
    expect(raw?._id).toBe('jti-id-guard');
    expect(typeof raw?._id).toBe('string');
  });
});
