import { createRealtimeSessionAuthenticatorAdapter } from '../../src/composition/realtimeSessionAuthenticatorAdapter.js';
import type {
  SessionTokenPayload,
  SessionTokenService,
} from '../../src/modules/identity-access/domain/ports/SessionTokenService.js';
import type { SessionRepository } from '../../src/modules/identity-access/domain/ports/SessionRepository.js';
import { Session } from '../../src/modules/identity-access/domain/model/aggregates/Session.js';
import { createSessionId } from '../../src/modules/identity-access/domain/model/value-objects/SessionId.js';
import { createOrganizationId } from '../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { fromDate } from '../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const FAR_FUTURE = fromDate(new Date('2099-01-01T00:00:00.000Z'));
const PAST = fromDate(new Date('2020-01-01T00:00:00.000Z'));
const ORG_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439012';
const SESSION_ID = '507f1f77bcf86cd799439013';

/** A fake SessionTokenService — deliberately NOT the real AES-GCM crypto adapter. */
class FakeSessionTokenService implements SessionTokenService {
  constructor(private readonly tokensByFingerprint = new Map<string, SessionTokenPayload>()) {}

  register(token: string, payload: SessionTokenPayload): void {
    this.tokensByFingerprint.set(token, payload);
  }

  issue(): string {
    throw new Error('not used in this test');
  }

  read(token: string): SessionTokenPayload | null {
    return this.tokensByFingerprint.get(token) ?? null;
  }

  fingerprint(token: string): string {
    return `fp:${token}`;
  }
}

/** A fake SessionRepository — in-memory, not Mongo. */
class FakeSessionRepository implements Partial<SessionRepository> {
  private readonly byHash = new Map<string, Session>();

  seed(hash: string, session: Session): void {
    this.byHash.set(hash, session);
  }

  async findByTokenHash(hash: string): Promise<Session | null> {
    return this.byHash.get(hash) ?? null;
  }
}

function buildSession(overrides: {
  expiresAt?: typeof NOW;
  deletedAt?: typeof NOW | null;
  organizationId?: string | null;
  userId?: string | null;
}): Session {
  return Session.rehydrate({
    id: createSessionId(SESSION_ID),
    userId: overrides.userId === undefined ? USER_ID : overrides.userId,
    organizationId:
      overrides.organizationId === undefined
        ? createOrganizationId(ORG_ID)
        : overrides.organizationId === null
          ? null
          : createOrganizationId(overrides.organizationId),
    adminOrganizationId: null,
    tokenHash: 'fp:token',
    expiresAt: overrides.expiresAt ?? FAR_FUTURE,
    ipAddress: null,
    userAgent: null,
    createdAt: NOW,
    deletedAt: overrides.deletedAt ?? null,
  });
}

function buildFixture() {
  const tokenService = new FakeSessionTokenService();
  const sessionRepository = new FakeSessionRepository();
  const authenticator = createRealtimeSessionAuthenticatorAdapter(
    tokenService,
    sessionRepository as unknown as SessionRepository,
  );
  return { tokenService, sessionRepository, authenticator };
}

describe('realtimeSessionAuthenticatorAdapter', () => {
  it('resolves {organizationId, userId} for a valid ACCESS session', async () => {
    const { tokenService, sessionRepository, authenticator } = buildFixture();
    tokenService.register('token1', { sessionId: SESSION_ID, tokenType: 'ACCESS', keyVersion: 1 });
    sessionRepository.seed('fp:token1', buildSession({}));

    const principal = await authenticator.authenticate('token1');

    expect(principal).toEqual({ organizationId: ORG_ID, userId: USER_ID });
  });

  it('returns null for a missing token', async () => {
    const { authenticator } = buildFixture();

    const principal = await authenticator.authenticate('unknown-token');

    expect(principal).toBeNull();
  });

  it('returns null for a non-ACCESS token (e.g. REFRESH)', async () => {
    const { tokenService, sessionRepository, authenticator } = buildFixture();
    tokenService.register('token1', { sessionId: SESSION_ID, tokenType: 'REFRESH', keyVersion: 1 });
    sessionRepository.seed('fp:token1', buildSession({}));

    const principal = await authenticator.authenticate('token1');

    expect(principal).toBeNull();
  });

  it('returns null for a revoked session', async () => {
    const { tokenService, sessionRepository, authenticator } = buildFixture();
    tokenService.register('token1', { sessionId: SESSION_ID, tokenType: 'ACCESS', keyVersion: 1 });
    sessionRepository.seed('fp:token1', buildSession({ deletedAt: NOW }));

    const principal = await authenticator.authenticate('token1');

    expect(principal).toBeNull();
  });

  it('returns null for an expired session', async () => {
    const { tokenService, sessionRepository, authenticator } = buildFixture();
    tokenService.register('token1', { sessionId: SESSION_ID, tokenType: 'ACCESS', keyVersion: 1 });
    sessionRepository.seed('fp:token1', buildSession({ expiresAt: PAST }));

    const principal = await authenticator.authenticate('token1');

    expect(principal).toBeNull();
  });
});
