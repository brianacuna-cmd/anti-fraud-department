import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoSessionRepository } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoSessionRepository.js';
import { MongoUnitOfWork } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { MongoAuditLogRepository } from '../../../src/modules/audit/infrastructure/adapters/outbound/mongo/MongoAuditLogRepository.js';
import { createRecordAuditLogUseCase } from '../../../src/modules/audit/application/RecordAuditLog.js';
import { generateAuditLogId } from '../../../src/modules/audit/domain/model/value-objects/AuditLogId.js';
import { createAuditRecorderAdapter } from '../../../src/composition/auditRecorderAdapter.js';
import { createSessionIssuer } from '../../../src/modules/identity-access/application/auth/SessionIssuer.js';
import { createRefreshSessionUseCase } from '../../../src/modules/identity-access/application/auth/RefreshSession.js';
import { AesGcmSessionTokenService } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSessionTokenService.js';
import { AesGcmSecretCipher } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { SystemClock } from '../../../src/shared/time/SystemClock.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { createOrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import type { Clock } from '../../../src/shared/time/Clock.js';
import type { Instant } from '../../../src/shared/time/Instant.js';
import { oid } from '../../support/oid.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_ID = createOrganizationId(oid('org-1'));
const SECRET_CIPHER = new AesGcmSecretCipher('test-secret', 1);
const TOKEN_SERVICE = new AesGcmSessionTokenService(SECRET_CIPHER);
const TTLS = { sessionSeconds: 900, refreshSeconds: 1_209_600, familySeconds: 2_592_000 };

/** Deterministic `Clock` fake — always returns the same fixed `Instant` for this test. */
class FixedClock implements Clock {
  now(): Instant {
    return NOW;
  }
}

/**
 * `RefreshSession` concurrency + rotation/reuse integration suite (design
 * "9. Test artifacts" — PR-2 integration: "concurrent double-refresh of the
 * SAME token; assert exactly ONE winner (markRotated CAS), the loser
 * triggers revokeFamily, and the family's live sessions end revoked — the
 * unsessioned revokeFamily must survive the loser's rollback"). Mirrors
 * `MongoMfaChallengeRepository.test.ts`'s concurrent-CAS pattern and
 * `organizationStatusAudit.test.ts`'s real-transaction-rollback pattern, but
 * exercises the FULL use case (not just the repository) against a real
 * replica-set Mongo — this race is the one thing in-memory fakes cannot
 * fully prove ordering for.
 */
describe('RefreshSession concurrency (integration, real replica-set Mongo transaction)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let sessions: MongoSessionRepository;
  let auditRecorder: ReturnType<typeof createAuditRecorderAdapter>;

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
    sessions = new MongoSessionRepository(db);
    const auditLogs = new MongoAuditLogRepository(db);
    const recordAuditLog = createRecordAuditLogUseCase({ auditLogs, clock: new SystemClock(), generateAuditLogId });
    auditRecorder = createAuditRecorderAdapter(recordAuditLog);
  });

  afterEach(async () => {
    await db.collection('Sessions').deleteMany({});
    await db.collection('AuditLogs').deleteMany({});
  });

  function buildRefreshSession() {
    const issueSessionFor = createSessionIssuer({
      sessionTokenService: TOKEN_SERVICE,
      sessions,
      tokenKeyVersion: 1,
      ttls: TTLS,
    });
    return createRefreshSessionUseCase({
      sessionTokenService: TOKEN_SERVICE,
      sessions,
      issueSessionFor,
      unitOfWork: new MongoUnitOfWork(client),
      clock: new FixedClock(),
      auditRecorder,
    });
  }

  async function mintOrgSession() {
    const issueSessionFor = createSessionIssuer({
      sessionTokenService: TOKEN_SERVICE,
      sessions,
      tokenKeyVersion: 1,
      ttls: TTLS,
    });
    const unitOfWork = new MongoUnitOfWork(client);
    return unitOfWork.withTransaction((tx) =>
      issueSessionFor({ userId: null, organizationId: ORG_ID, actorType: 'ORGANIZATION', now: NOW, tx }),
    );
  }

  it('happy path: rotates once, old marked rotated, new session valid, old refresh token no longer usable', async () => {
    const minted = await mintOrgSession();
    const refreshSession = buildRefreshSession();

    const rotated = await refreshSession({ refreshToken: minted.refreshToken! });

    expect(rotated.accessToken).not.toBe(minted.accessToken);
    const oldSession = await sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(minted.accessToken));
    expect(oldSession?.rotatedAt).not.toBeNull();
    expect(oldSession?.deletedAt).toBeNull();

    const newSession = await sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(rotated.accessToken));
    expect(newSession?.rotatedAt).toBeNull();
    expect(newSession?.familyId).toBe(oldSession?.familyId);
    expect(newSession?.rotatedFromSessionId).toBe(oldSession?.id);

    await expect(refreshSession({ refreshToken: minted.refreshToken! })).rejects.toMatchObject({
      code: 'SESSION_INVALID',
    });

    const auditRows = await db.collection('AuditLogs').find({}).toArray();
    expect(auditRows.map((row) => row.Action)).toContain('SESSION_REFRESHED');
  });

  it('reuse-replay: presenting an already-rotated refresh token revokes the whole family', async () => {
    const minted = await mintOrgSession();
    const refreshSession = buildRefreshSession();
    const rotated = await refreshSession({ refreshToken: minted.refreshToken! });

    await expect(refreshSession({ refreshToken: minted.refreshToken! })).rejects.toMatchObject({
      code: 'SESSION_INVALID',
    });

    const oldSession = await sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(minted.accessToken));
    const successorSession = await sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(rotated.accessToken));
    expect(oldSession?.deletedAt).not.toBeNull();
    expect(successorSession?.deletedAt).not.toBeNull();

    const auditRows = await db.collection('AuditLogs').find({}).toArray();
    expect(auditRows.map((row) => row.Action)).toContain('SESSION_REUSE_DETECTED');
  });

  /**
   * The core race this integration test exists to prove (design "9. Test
   * artifacts" PR-2 integration): TWO concurrent `/auth/refresh`-equivalent
   * calls presenting the EXACT SAME refresh token against a REAL Mongo
   * replica set. Exactly one may win the atomic `markRotated` CAS; the
   * loser's transaction rolls back its `markRotated` write, but the
   * UNSESSIONED `revokeFamily` call (design D16) must still land and revoke
   * every live session in the family — including the winner's newly minted
   * successor.
   */
  it('two concurrent refresh calls with the SAME refresh token against real Mongo: exactly one wins, the loser revokes the whole family', async () => {
    const minted = await mintOrgSession();
    const refreshSession = buildRefreshSession();

    const results = await Promise.allSettled([
      refreshSession({ refreshToken: minted.refreshToken! }),
      refreshSession({ refreshToken: minted.refreshToken! }),
    ]);

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof refreshSession>>> => r.status === 'fulfilled',
    );
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The original session must be rotated exactly once (the CAS winner).
    const oldSession = await sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(minted.accessToken));
    expect(oldSession?.rotatedAt).not.toBeNull();

    // The reuse-detection path fires for the CAS loser, revoking the WHOLE
    // family — the unsessioned `revokeFamily` survives the loser's own
    // transaction rollback (design D16), so even the winner's brand-new
    // successor session ends up revoked.
    expect(oldSession?.deletedAt).not.toBeNull();
    const winnerSession = fulfilled[0]?.value;
    expect(winnerSession).toBeDefined();
    const successorSession = await sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(winnerSession!.accessToken));
    expect(successorSession?.deletedAt).not.toBeNull();

    const auditRows = await db.collection('AuditLogs').find({}).toArray();
    expect(auditRows.map((row) => row.Action)).toContain('SESSION_REUSE_DETECTED');
    expect(auditRows.map((row) => row.Action)).toContain('SESSION_REFRESHED');
  });
});
