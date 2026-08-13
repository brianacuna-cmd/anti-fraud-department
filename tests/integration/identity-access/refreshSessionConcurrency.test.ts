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
const TTLS = { sessionSeconds: 900 };

class FixedClock implements Clock {
  now(): Instant {
    return NOW;
  }
}

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
    await db.collection('sessions').deleteMany({});
    await db.collection('audit_logs').deleteMany({});
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
      issueSessionFor({ userId: null, organizationId: ORG_ID, now: NOW, tx }),
    );
  }

  it('happy path: refresh still works; old session is revoked, new session is live', async () => {
    const minted = await mintOrgSession();
    const refreshSession = buildRefreshSession();

    const rotated = await refreshSession({ refreshToken: minted.refreshToken! });

    expect(rotated.accessToken).not.toBe(minted.accessToken);
    const oldSession = await sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(minted.accessToken));
    expect(oldSession?.deletedAt).not.toBeNull();

    const newSession = await sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(rotated.accessToken));
    expect(newSession?.deletedAt).toBeNull();

    await expect(refreshSession({ refreshToken: minted.refreshToken! })).rejects.toMatchObject({
      code: 'SESSION_INVALID',
    });

    const auditRows = await db.collection('audit_logs').find({}).toArray();
    expect(auditRows.map((row) => row.action)).toContain('SESSION_REFRESHED');
  });

  it('reusing the old refresh token does not burn the successor', async () => {
    const minted = await mintOrgSession();
    const refreshSession = buildRefreshSession();
    const rotated = await refreshSession({ refreshToken: minted.refreshToken! });

    await expect(refreshSession({ refreshToken: minted.refreshToken! })).rejects.toMatchObject({
      code: 'SESSION_INVALID',
    });

    const successorSession = await sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(rotated.accessToken));
    expect(successorSession?.deletedAt).toBeNull();

    const again = await refreshSession({ refreshToken: rotated.refreshToken! });
    expect(again.accessToken).toBeDefined();
  });

  it('two concurrent refresh calls with the SAME refresh token: at least one succeeds', async () => {
    const minted = await mintOrgSession();
    const refreshSession = buildRefreshSession();

    const results = await Promise.allSettled([
      refreshSession({ refreshToken: minted.refreshToken! }),
      refreshSession({ refreshToken: minted.refreshToken! }),
    ]);

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof refreshSession>>> => r.status === 'fulfilled',
    );
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const oldSession = await sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(minted.accessToken));
    expect(oldSession?.deletedAt).not.toBeNull();

    const auditRows = await db.collection('audit_logs').find({}).toArray();
    expect(auditRows.map((row) => row.action)).toContain('SESSION_REFRESHED');
  });
});
