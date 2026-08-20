import { oid } from '../../../../support/oid.js';
import { createRefreshSessionUseCase } from '../../../../../src/modules/identity-access/application/auth/RefreshSession.js';
import { createSessionIssuer } from '../../../../../src/modules/identity-access/application/auth/SessionIssuer.js';
import { InMemorySessionRepository } from '../../../../helpers/identity-access/InMemorySessionRepository.js';
import { InMemoryUnitOfWork } from '../../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FixedClock } from '../../../../helpers/FixedClock.js';
import { AesGcmSessionTokenService } from '../../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSessionTokenService.js';
import { AesGcmSecretCipher } from '../../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { createOrganizationId } from '../../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createAdminOrganizationId } from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminOrganizationId.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const SECRET_CIPHER = new AesGcmSecretCipher('test-secret', 1);
const TOKEN_SERVICE = new AesGcmSessionTokenService(SECRET_CIPHER);
const ORG_ID = createOrganizationId(oid('org-1'));
const ADMIN_ID = createAdminOrganizationId(oid('admin-1'));

const TTLS = { sessionSeconds: 900 };

function buildHarness(clock = new FixedClock(NOW)) {
  const sessions = new InMemorySessionRepository();
  const unitOfWork = new InMemoryUnitOfWork();
  const auditRecorder = new InMemoryAuditRecorder();
  const issueSessionFor = createSessionIssuer({
    sessionTokenService: TOKEN_SERVICE,
    sessions,
    tokenKeyVersion: 1,
    ttls: TTLS,
  });
  const refreshSession = createRefreshSessionUseCase({
    sessionTokenService: TOKEN_SERVICE,
    sessions,
    issueSessionFor,
    unitOfWork,
    clock,
    auditRecorder,
  });
  return { sessions, unitOfWork, auditRecorder, issueSessionFor, refreshSession, clock };
}

async function mintUserSession(harness: ReturnType<typeof buildHarness>, now = NOW) {
  return harness.unitOfWork.withTransaction((tx) =>
    harness.issueSessionFor({ userId: oid('user-1'), organizationId: ORG_ID, now, tx }),
  );
}

describe('createRefreshSessionUseCase', () => {
  it('happy path: revokes the old session, mints a new access token, emits SESSION_REFRESHED', async () => {
    const harness = buildHarness();
    const minted = await mintUserSession(harness);

    const result = await harness.refreshSession({ refreshToken: minted.refreshToken! });

    expect(result.accessToken).not.toBe(minted.accessToken);
    expect(result.refreshToken).toBeDefined();

    const oldSession = await harness.sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(minted.accessToken));
    expect(oldSession?.deletedAt).toBe(NOW);

    const newSession = await harness.sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(result.accessToken));
    expect(newSession).not.toBeNull();
    expect(newSession?.deletedAt).toBeNull();
    expect(newSession?.id).not.toBe(oldSession?.id);

    const events = harness.auditRecorder.all();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'SESSION_REFRESHED', resource: 'sessions' });
  });

  it('reusing the old refresh token after revoke is SESSION_INVALID; successor remains usable', async () => {
    const harness = buildHarness();
    const minted = await mintUserSession(harness);
    const successor = await harness.refreshSession({ refreshToken: minted.refreshToken! });

    await expect(harness.refreshSession({ refreshToken: minted.refreshToken! })).rejects.toMatchObject({
      code: 'SESSION_INVALID',
    });

    const liveSuccessor = await harness.sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(successor.accessToken));
    expect(liveSuccessor?.deletedAt).toBeNull();

    const refreshedAgain = await harness.refreshSession({ refreshToken: successor.refreshToken! });
    expect(refreshedAgain.accessToken).toBeDefined();
  });

  it('unknown/forged token is rejected with no session revoke', async () => {
    const harness = buildHarness();
    const minted = await mintUserSession(harness);

    await expect(harness.refreshSession({ refreshToken: 'not-a-real-token' })).rejects.toMatchObject({
      code: 'SESSION_INVALID',
    });
    expect(harness.auditRecorder.all()).toHaveLength(0);
    const stillLive = await harness.sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(minted.accessToken));
    expect(stillLive?.deletedAt).toBeNull();
  });

  it('an ACCESS token presented at refresh is rejected (wrong token type)', async () => {
    const harness = buildHarness();
    const minted = await mintUserSession(harness);

    await expect(harness.refreshSession({ refreshToken: minted.accessToken })).rejects.toMatchObject({
      code: 'SESSION_INVALID',
    });
  });

  it('PLATFORM_ADMIN cannot refresh — refreshToken is null; presenting ACCESS is SESSION_INVALID', async () => {
    const harness = buildHarness();
    const minted = await harness.unitOfWork.withTransaction((tx) =>
      harness.issueSessionFor({ adminOrganizationId: ADMIN_ID, now: NOW, tx }),
    );
    expect(minted.refreshToken).toBeNull();

    await expect(harness.refreshSession({ refreshToken: minted.accessToken })).rejects.toMatchObject({
      code: 'SESSION_INVALID',
    });
  });

  it('expired session is rejected without revoking the row', async () => {
    const harness = buildHarness();
    const minted = await mintUserSession(harness, NOW);

    const wayLater = fromDate(new Date('2026-01-01T00:16:00.000Z'));
    harness.clock.now = () => wayLater;

    await expect(harness.refreshSession({ refreshToken: minted.refreshToken! })).rejects.toMatchObject({
      code: 'SESSION_INVALID',
    });
    expect(harness.auditRecorder.all()).toHaveLength(0);
    const stillLive = await harness.sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(minted.accessToken));
    expect(stillLive?.deletedAt).toBeNull();
  });

  it('two concurrent refresh calls with the SAME token: at least one succeeds', async () => {
    const harness = buildHarness();
    const minted = await mintUserSession(harness);

    const results = await Promise.allSettled([
      harness.refreshSession({ refreshToken: minted.refreshToken! }),
      harness.refreshSession({ refreshToken: minted.refreshToken! }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
  });
});
