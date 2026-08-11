import type { Request } from 'express';
import type { AuthContext } from '../../../../../../../shared/kernel/AuthContext.js';
import { createAuthContext } from '../../../../../../../shared/kernel/AuthContext.js';
import { toDate } from '../../../../../../../shared/time/Instant.js';
import type { AuthContextResolver } from './AuthContextResolver.js';
import type { ScopedMfaPayload, SessionTokenService } from '../../../../../domain/ports/SessionTokenService.js';
import type { SessionRepository } from '../../../../../domain/ports/SessionRepository.js';

const AUTHORIZATION_HEADER = 'authorization';
const BEARER_PREFIX = 'Bearer ';

function extractBearerToken(req: Request): string | null {
  const header = req.headers[AUTHORIZATION_HEADER];
  const value = typeof header === 'string' ? header : undefined;
  if (!value?.startsWith(BEARER_PREFIX)) {
    return null;
  }
  const token = value.slice(BEARER_PREFIX.length);
  return token.length > 0 ? token : null;
}

/**
 * Real session-backed `AuthContextResolver` (design D12/D13) — the
 * `AUTH_MODE=session` counterpart to `TrustedHeaderAuthContextResolver`.
 * Every resolution costs exactly ONE `Sessions.TokenHash` lookup
 * (authentication-session spec: "Opaque Token Format and Session Lookup") —
 * the token carries only a pointer (`sessionId`/`tokenType`), never the
 * actor's identity, so a revoked or expired row fails the request even with
 * an otherwise well-formed, correctly-decrypting token.
 *
 * Judgment call (PR3b, no login/mfa endpoint exists yet to observe this
 * against a real token): for an `ORGANIZATION`-tier session, `Sessions.UserId`
 * is `null` (design D14) — `organizationId` IS the authenticated principal
 * for that tier, so `AuthContext.userId` is populated from
 * `session.organizationId` in that one case.
 */
export class SessionTokenAuthContextResolver implements AuthContextResolver {
  constructor(
    private readonly sessionTokenService: SessionTokenService,
    private readonly sessionRepository: SessionRepository,
  ) {}

  async resolve(req: Request): Promise<AuthContext | null> {
    const token = extractBearerToken(req);
    if (!token) {
      return null;
    }

    const payload = this.sessionTokenService.read(token);
    if (!payload) {
      return null;
    }

    if (payload.tokenType === 'mfa_challenge' || payload.tokenType === 'mfa_enrollment') {
      return this.resolveScoped(payload);
    }

    if (payload.tokenType !== 'ACCESS') {
      return null;
    }

    const fingerprint = this.sessionTokenService.fingerprint(token);
    const session = await this.sessionRepository.findByTokenHash(fingerprint);
    if (!session || session.isRevoked) {
      return null;
    }
    // A rotated session is superseded by its successor (session-lifecycle
    // PR-2): `RefreshSession` sets `rotatedAt` on the old row but does NOT
    // delete it (the row is kept for reuse-detection). Its ACCESS token must
    // stop authenticating the moment it is rotated — otherwise the old access
    // token would stay valid until its natural TTL, defeating rotation.
    if (session.rotatedAt !== null) {
      return null;
    }
    if (toDate(session.expiresAt).getTime() <= Date.now()) {
      return null;
    }

    const userId = session.actorType === 'ORGANIZATION' ? (session.organizationId ?? '') : (session.userId ?? '');

    return createAuthContext({
      userId,
      organizationId: session.organizationId,
      actorType: session.actorType,
      sessionId: session.id,
    });
  }

  /**
   * Scoped branch for `mfa_challenge`/`mfa_enrollment` tokens (design D5,
   * two-step-login PR3) — these carry NO `Sessions` row of their own
   * (design D2), so unlike ACCESS there is deliberately no repository
   * lookup here: identity + expiry both ride in the token's own claims
   * (`ScopedMfaPayload`), checked via self-expiry only. Consumption
   * (`MfaChallengeStore.consume`) happens downstream, at the use case that
   * actually spends the token (`IssueSession`/`ActivateMfa`) — a resolver
   * is invoked on EVERY request an enrollment token is presented on
   * (including ones it will be denied on by `requireAuthContext`'s
   * default-deny), so consuming here would burn the single use on a
   * request that never even reaches an authorized route.
   */
  private resolveScoped(payload: ScopedMfaPayload): AuthContext | null {
    if (new Date(payload.expiresAt).getTime() <= Date.now()) {
      return null;
    }

    return createAuthContext({
      userId: payload.userId,
      organizationId: payload.organizationId,
      actorType: payload.actorType,
      purpose: payload.tokenType === 'mfa_challenge' ? 'challenge' : 'enrollment',
      mfaJti: payload.jti,
    });
  }
}
