import type { Request } from 'express';
import { SessionTokenAuthContextResolver } from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/auth/SessionTokenAuthContextResolver.js';
import { AesGcmSecretCipher } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { AesGcmSessionTokenService } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSessionTokenService.js';
import { InMemorySessionRepository } from '../../../helpers/identity-access/InMemorySessionRepository.js';
import { Session } from '../../../../src/modules/identity-access/domain/model/aggregates/Session.js';
import { createSessionId } from '../../../../src/modules/identity-access/domain/model/value-objects/SessionId.js';
import { createFamilyId } from '../../../../src/modules/identity-access/domain/model/value-objects/FamilyId.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const FAR_FUTURE = fromDate(new Date('2099-01-01T00:00:00.000Z'));
const PAST = fromDate(new Date('2020-01-01T00:00:00.000Z'));
const FAR_FUTURE_ISO = '2099-01-01T00:00:00.000Z';
const PAST_ISO = '2020-01-01T00:00:00.000Z';

function buildRequest(bearerToken?: string): Request {
  return {
    headers: bearerToken ? { authorization: `Bearer ${bearerToken}` } : {},
  } as Request;
}

function buildFixture() {
  const tokenService = new AesGcmSessionTokenService(new AesGcmSecretCipher('token-secret', 1));
  const sessionRepository = new InMemorySessionRepository();
  const resolver = new SessionTokenAuthContextResolver(tokenService, sessionRepository);
  return { tokenService, sessionRepository, resolver };
}

async function seedSession(
  sessionRepository: InMemorySessionRepository,
  overrides: {
    id: string;
    tokenHash: string;
    userId?: string | null;
    organizationId?: string | null;
    actorType?: 'USER' | 'ORGANIZATION' | 'PLATFORM_ADMIN';
    expiresAt?: typeof NOW;
    deletedAt?: typeof NOW | null;
  },
): Promise<void> {
  const session = Session.rehydrate({
    id: createSessionId(overrides.id),
    userId: overrides.userId === undefined ? 'user-1' : overrides.userId,
    organizationId:
      overrides.organizationId === undefined
        ? createOrganizationId('org-1')
        : overrides.organizationId === null
          ? null
          : createOrganizationId(overrides.organizationId),
    actorType: overrides.actorType ?? 'USER',
    tokenHash: overrides.tokenHash,
    refreshTokenHash: 'refresh-hash',
    expiresAt: overrides.expiresAt ?? FAR_FUTURE,
    refreshExpiresAt: FAR_FUTURE,
    familyId: createFamilyId('family-1'),
    familyExpiresAt: FAR_FUTURE,
    rotatedAt: null,
    rotatedFromSessionId: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: overrides.deletedAt ?? null,
  });
  await sessionRepository.save(session);
}

describe('SessionTokenAuthContextResolver', () => {
  it('resolves AuthContext for a valid, unexpired, unrevoked USER session', async () => {
    const { tokenService, sessionRepository, resolver } = buildFixture();
    const token = tokenService.issue({ sessionId: 'session-1', tokenType: 'ACCESS', keyVersion: 1 });
    await seedSession(sessionRepository, {
      id: 'session-1',
      tokenHash: tokenService.fingerprint(token),
      userId: 'user-1',
      organizationId: 'org-1',
      actorType: 'USER',
    });

    const auth = await resolver.resolve(buildRequest(token));

    expect(auth?.userId).toBe('user-1');
    expect(auth?.organizationId).toBe('org-1');
    expect(auth?.actorType).toBe('USER');
    expect(auth?.sessionId).toBe('session-1');
  });

  it('resolves AuthContext for an ORGANIZATION session using organizationId as the principal', async () => {
    const { tokenService, sessionRepository, resolver } = buildFixture();
    const token = tokenService.issue({ sessionId: 'org-session-1', tokenType: 'ACCESS', keyVersion: 1 });
    await seedSession(sessionRepository, {
      id: 'org-session-1',
      tokenHash: tokenService.fingerprint(token),
      userId: null,
      organizationId: 'org-1',
      actorType: 'ORGANIZATION',
    });

    const auth = await resolver.resolve(buildRequest(token));

    expect(auth?.userId).toBe('org-1');
    expect(auth?.actorType).toBe('ORGANIZATION');
  });

  it('returns null when no bearer token is present', async () => {
    const { resolver } = buildFixture();

    expect(await resolver.resolve(buildRequest())).toBeNull();
  });

  it('returns null for a garbage/undecryptable token', async () => {
    const { resolver } = buildFixture();

    expect(await resolver.resolve(buildRequest('not-a-real-token'))).toBeNull();
  });

  it('returns null when the token is a REFRESH token, not an ACCESS token', async () => {
    const { tokenService, sessionRepository, resolver } = buildFixture();
    const token = tokenService.issue({ sessionId: 'session-1', tokenType: 'REFRESH', keyVersion: 1 });
    await seedSession(sessionRepository, { id: 'session-1', tokenHash: tokenService.fingerprint(token) });

    expect(await resolver.resolve(buildRequest(token))).toBeNull();
  });

  it('returns null when the session cannot be found by TokenHash', async () => {
    const { tokenService, resolver } = buildFixture();
    const token = tokenService.issue({ sessionId: 'missing-session', tokenType: 'ACCESS', keyVersion: 1 });

    expect(await resolver.resolve(buildRequest(token))).toBeNull();
  });

  it('returns null immediately for a revoked session, even before ExpiresAt (design: "Revoked token rejected immediately")', async () => {
    const { tokenService, sessionRepository, resolver } = buildFixture();
    const token = tokenService.issue({ sessionId: 'session-1', tokenType: 'ACCESS', keyVersion: 1 });
    await seedSession(sessionRepository, {
      id: 'session-1',
      tokenHash: tokenService.fingerprint(token),
      deletedAt: NOW,
    });

    expect(await resolver.resolve(buildRequest(token))).toBeNull();
  });

  it('returns null for an expired session', async () => {
    const { tokenService, sessionRepository, resolver } = buildFixture();
    const token = tokenService.issue({ sessionId: 'session-1', tokenType: 'ACCESS', keyVersion: 1 });
    await seedSession(sessionRepository, {
      id: 'session-1',
      tokenHash: tokenService.fingerprint(token),
      expiresAt: PAST,
    });

    expect(await resolver.resolve(buildRequest(token))).toBeNull();
  });

  describe('scoped mfa_challenge/mfa_enrollment tokens (two-step-login PR3, design D5)', () => {
    it('resolves a purpose:"enrollment" AuthContext for a valid mfa_enrollment token, with NO Sessions lookup', async () => {
      const { tokenService, resolver } = buildFixture();
      const token = tokenService.issue({
        tokenType: 'mfa_enrollment',
        keyVersion: 1,
        jti: 'jti-1',
        userId: 'user-1',
        organizationId: 'org-1',
        actorType: 'USER',
        expiresAt: FAR_FUTURE_ISO,
      });

      const auth = await resolver.resolve(buildRequest(token));

      expect(auth?.userId).toBe('user-1');
      expect(auth?.organizationId).toBe('org-1');
      expect(auth?.actorType).toBe('USER');
      expect(auth?.purpose).toBe('enrollment');
      expect(auth?.mfaJti).toBe('jti-1');
      expect(auth?.sessionId).toBeNull();
    });

    it('resolves a purpose:"challenge" AuthContext for a valid mfa_challenge token (defense-in-depth — every route still denies it via default-deny)', async () => {
      const { tokenService, resolver } = buildFixture();
      const token = tokenService.issue({
        tokenType: 'mfa_challenge',
        keyVersion: 1,
        jti: 'jti-2',
        userId: 'user-1',
        organizationId: 'org-1',
        actorType: 'USER',
        expiresAt: FAR_FUTURE_ISO,
      });

      const auth = await resolver.resolve(buildRequest(token));

      expect(auth?.purpose).toBe('challenge');
      expect(auth?.mfaJti).toBe('jti-2');
    });

    it('returns null for a self-expired mfa_enrollment token, without ever consulting a store', async () => {
      const { tokenService, resolver } = buildFixture();
      const token = tokenService.issue({
        tokenType: 'mfa_enrollment',
        keyVersion: 1,
        jti: 'jti-3',
        userId: 'user-1',
        organizationId: 'org-1',
        actorType: 'USER',
        expiresAt: PAST_ISO,
      });

      expect(await resolver.resolve(buildRequest(token))).toBeNull();
    });
  });

  describe('password_reset tokens (password-management PR-2a) are never accepted as an auth context', () => {
    it('returns null for a valid, unexpired password_reset token — it is a reset token, not a session', async () => {
      const { tokenService, resolver } = buildFixture();
      const token = tokenService.issue({
        tokenType: 'password_reset',
        keyVersion: 1,
        jti: 'jti-reset-1',
        userId: 'user-1',
        organizationId: 'org-1',
        actorType: 'USER',
        expiresAt: FAR_FUTURE_ISO,
      });

      expect(await resolver.resolve(buildRequest(token))).toBeNull();
    });
  });
});
