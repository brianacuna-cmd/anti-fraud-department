import { createRefreshSessionUseCase } from '../../../../../src/modules/identity-access/application/auth/RefreshSession.js';
import { createSessionIssuer } from '../../../../../src/modules/identity-access/application/auth/SessionIssuer.js';
import { InMemorySessionRepository } from '../../../../helpers/identity-access/InMemorySessionRepository.js';
import { InMemoryUnitOfWork } from '../../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FixedClock } from '../../../../helpers/FixedClock.js';
import { AesGcmSessionTokenService } from '../../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSessionTokenService.js';
import { AesGcmSecretCipher } from '../../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { createOrganizationId } from '../../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';
import { IdentityAccessError } from '../../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const SECRET_CIPHER = new AesGcmSecretCipher('test-secret', 1);
const TOKEN_SERVICE = new AesGcmSessionTokenService(SECRET_CIPHER);
const ORG_ID = createOrganizationId('org-1');

const TTLS = { sessionSeconds: 900, refreshSeconds: 1_209_600, familySeconds: 2_592_000 };

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
    harness.issueSessionFor({ userId: 'user-1', organizationId: ORG_ID, actorType: 'USER', now, tx }),
  );
}

describe('createRefreshSessionUseCase', () => {
  it('happy path: rotates, mints a new linked session, marks old rotated, emits SESSION_REFRESHED', async () => {
    const harness = buildHarness();
    const minted = await mintUserSession(harness);

    const result = await harness.refreshSession({ refreshToken: minted.refreshToken! });

    expect(result.accessToken).not.toBe(minted.accessToken);
    expect(result.refreshToken).not.toBe(minted.refreshToken);

    const oldSession = await harness.sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(minted.accessToken));
    expect(oldSession?.rotatedAt).toBe(NOW);

    const newSession = await harness.sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(result.accessToken));
    expect(newSession?.familyId).toBe(oldSession?.familyId);
    expect(newSession?.rotatedFromSessionId).toBe(oldSession?.id);
    expect(newSession?.rotatedAt).toBeNull();

    const events = harness.auditRecorder.all();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'SESSION_REFRESHED', resource: 'sessions' });
  });

  it('the old ACCESS/REFRESH pair is no longer usable to refresh again after rotation', async () => {
    const harness = buildHarness();
    const minted = await mintUserSession(harness);
    await harness.refreshSession({ refreshToken: minted.refreshToken! });

    await expect(harness.refreshSession({ refreshToken: minted.refreshToken! })).rejects.toMatchObject({
      code: 'SESSION_INVALID',
    });
  });

  it('reused (already-rotated) refresh token triggers family revocation and SESSION_REUSE_DETECTED', async () => {
    const harness = buildHarness();
    const minted = await mintUserSession(harness);
    const rotated = await harness.refreshSession({ refreshToken: minted.refreshToken! });

    await expect(harness.refreshSession({ refreshToken: minted.refreshToken! })).rejects.toBeInstanceOf(
      IdentityAccessError,
    );

    // the sibling (successor) session, though never itself rotated again,
    // must also be revoked — the WHOLE family is burned.
    const successor = await harness.sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(rotated.accessToken));
    expect(successor?.deletedAt).not.toBeNull();

    const events = harness.auditRecorder.all();
    expect(events.map((e) => e.action)).toContain('SESSION_REUSE_DETECTED');
  });

  it('the successor minted from a reused token is unusable (family already revoked)', async () => {
    const harness = buildHarness();
    const minted = await mintUserSession(harness);
    const rotated = await harness.refreshSession({ refreshToken: minted.refreshToken! });
    await expect(harness.refreshSession({ refreshToken: minted.refreshToken! })).rejects.toThrow();

    await expect(harness.refreshSession({ refreshToken: rotated.refreshToken! })).rejects.toMatchObject({
      code: 'SESSION_INVALID',
    });
  });

  it('unknown/forged token is rejected with no family revoke', async () => {
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

  it('PLATFORM_ADMIN cannot refresh — its ACCESS token is the only token it ever holds', async () => {
    const harness = buildHarness();
    const minted = await harness.unitOfWork.withTransaction((tx) =>
      harness.issueSessionFor({ userId: 'admin-1', organizationId: null, actorType: 'PLATFORM_ADMIN', now: NOW, tx }),
    );
    expect(minted.refreshToken).toBeNull();

    await expect(harness.refreshSession({ refreshToken: minted.accessToken })).rejects.toMatchObject({
      code: 'SESSION_INVALID',
    });
  });

  it('expired refresh token is rejected WITHOUT revoking the family', async () => {
    const mintClock = new FixedClock(NOW);
    const harness = buildHarness(mintClock);
    const minted = await mintUserSession(harness, NOW);

    const wayLater = fromDate(new Date('2026-02-01T00:00:00.000Z')); // past refreshSeconds TTL
    harness.clock.now = () => wayLater;

    await expect(harness.refreshSession({ refreshToken: minted.refreshToken! })).rejects.toMatchObject({
      code: 'SESSION_INVALID',
    });
    expect(harness.auditRecorder.all()).toHaveLength(0);
    const stillLive = await harness.sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(minted.accessToken));
    expect(stillLive?.deletedAt).toBeNull();
  });

  it('two concurrent refresh calls with the SAME token: exactly one wins, the loser triggers family revocation', async () => {
    const harness = buildHarness();
    const minted = await mintUserSession(harness);

    const results = await Promise.allSettled([
      harness.refreshSession({ refreshToken: minted.refreshToken! }),
      harness.refreshSession({ refreshToken: minted.refreshToken! }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const events = harness.auditRecorder.all();
    expect(events.map((e) => e.action)).toContain('SESSION_REUSE_DETECTED');
  });
});
