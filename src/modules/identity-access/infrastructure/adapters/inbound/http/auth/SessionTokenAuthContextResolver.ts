import type { Request } from 'express';
import type { AuthContext } from '../../../../../../../shared/kernel/AuthContext.js';
import { createAuthContext } from '../../../../../../../shared/kernel/AuthContext.js';
import { toDate } from '../../../../../../../shared/time/Instant.js';
import type { AuthContextResolver } from './AuthContextResolver.js';
import type { SessionTokenService } from '../../../../../domain/ports/SessionTokenService.js';
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
    if (!payload || payload.tokenType !== 'ACCESS') {
      return null;
    }

    const fingerprint = this.sessionTokenService.fingerprint(token);
    const session = await this.sessionRepository.findByTokenHash(fingerprint);
    if (!session || session.isRevoked) {
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
}
