import type { SessionTokenService } from '../modules/identity-access/domain/ports/SessionTokenService.js';
import type { SessionRepository } from '../modules/identity-access/domain/ports/SessionRepository.js';
import { toDate } from '../shared/time/Instant.js';
import type {
  AuthenticatedPrincipal,
  SessionAuthenticator,
} from '../modules/notifications/domain/ports/SessionAuthenticator.js';

/**
 * Composition bridge (wiring root — allowed to cross module boundaries,
 * boundaries-spike decision #538): implements the notifications module's
 * LOCAL `SessionAuthenticator` port by calling identity-access's real
 * `SessionTokenService`/`SessionRepository`. Mirrors the ACCESS branch of
 * `SessionTokenAuthContextResolver.resolve` exactly (read -> fingerprint ->
 * findByTokenHash, then revoked/expiry checks) — same pattern as
 * `notificationEmailSenderAdapter.ts`. Returns `null` for ANY failure
 * (missing/invalid/wrong-type token, revoked or expired session) — never
 * throws, per the `SessionAuthenticator` port contract.
 */
export function createRealtimeSessionAuthenticatorAdapter(
  sessionTokenService: SessionTokenService,
  sessionRepository: SessionRepository,
): SessionAuthenticator {
  return {
    async authenticate(token: string): Promise<AuthenticatedPrincipal | null> {
      const payload = sessionTokenService.read(token);
      if (!payload || payload.tokenType !== 'ACCESS') {
        return null;
      }

      const fingerprint = sessionTokenService.fingerprint(token);
      const session = await sessionRepository.findByTokenHash(fingerprint);
      if (!session || session.isRevoked) {
        return null;
      }
      if (toDate(session.expiresAt).getTime() <= Date.now()) {
        return null;
      }

      // Realtime notifications are per (organizationId, recipientUserId)
      // — only a USER-tier session carries both, so ORGANIZATION/
      // PLATFORM_ADMIN sessions (no real `userId`) never match a
      // notification recipient and are rejected here.
      if (session.actorType !== 'USER' || !session.organizationId || !session.userId) {
        return null;
      }

      return {
        organizationId: session.organizationId,
        userId: session.userId,
      };
    },
  };
}
