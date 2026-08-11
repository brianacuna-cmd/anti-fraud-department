import type { Clock } from '../../../../shared/time/Clock.js';
import { toDate } from '../../../../shared/time/Instant.js';
import type { SessionTokenService } from '../../domain/ports/SessionTokenService.js';
import type { SessionRepository } from '../../domain/ports/SessionRepository.js';
import type { UnitOfWork } from '../../domain/ports/UnitOfWork.js';
import type { AuditRecorder, AuditEvent } from '../../domain/ports/AuditRecorder.js';
import { sessionInvalid } from '../../domain/errors/IdentityAccessError.js';
import type { createSessionIssuer, MintedSession } from './SessionIssuer.js';

export interface RefreshSessionInput {
  readonly refreshToken: string;
  readonly ipAddress?: string | null;
}

export type RefreshSessionResult = MintedSession;

export interface RefreshSessionDeps {
  readonly sessionTokenService: SessionTokenService;
  readonly sessions: SessionRepository;
  readonly issueSessionFor: ReturnType<typeof createSessionIssuer>;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly auditRecorder: AuditRecorder;
}

/**
 * `POST /auth/refresh` use case (design "2. `RefreshSession` use case —
 * the crux", DD2). Rotates a REFRESH token: marks the presented session
 * rotated and mints a new session in the SAME rotation family. Any hint of
 * reuse — an already-rotated token presented again, OR the atomic
 * `markRotated` CAS losing a race to a concurrent presentation of the exact
 * same token — revokes the WHOLE family (design D16: `revokeFamily` is
 * unsessioned, so it survives this request's own rollback). Every failure
 * mode (unknown token, wrong token type, expired refresh/family, reuse,
 * CAS-loss) rejects with the SAME opaque `sessionInvalid()` — no branch at
 * the edge distinguishes them (design DD4).
 *
 * PLATFORM_ADMIN sessions never receive a REFRESH token (design D38) — an
 * admin's ACCESS token fails the `tokenType !== 'REFRESH'` gate below, so
 * the admin tier can never reach rotation (design DD9).
 */
export function createRefreshSessionUseCase(deps: RefreshSessionDeps) {
  /**
   * Best-effort, NON-transactional audit emission for the reuse-detection
   * branch — the caller's transaction (if any) is about to roll back via
   * `throw sessionInvalid()`, and `revokeFamily` itself is deliberately
   * unsessioned (design D16), so the audit trail for a family revoke must
   * never depend on that doomed transaction either.
   */
  async function emitBestEffort(event: AuditEvent): Promise<void> {
    try {
      await deps.auditRecorder.record(event);
    } catch {
      // best-effort: never let an audit failure change the rejection outcome
    }
  }

  return async function refreshSession(input: RefreshSessionInput): Promise<RefreshSessionResult> {
    const now = deps.clock.now();

    // A1 — token shape/type. Rejects ACCESS tokens, malformed/forged
    // ciphertext, and every non-REFRESH scoped token. PLATFORM_ADMIN holds
    // no REFRESH token, so its ACCESS token fails here (design DD9).
    const payload = deps.sessionTokenService.read(input.refreshToken);
    if (!payload || payload.tokenType !== 'REFRESH') {
      throw sessionInvalid();
    }

    // A2 — resolve the row by refresh hash. The token itself carries no
    // identity or expiry claim (design "Verified facts": SessionPointerPayload).
    const fingerprint = deps.sessionTokenService.fingerprint(input.refreshToken);
    const session = await deps.sessions.findByRefreshTokenHash(fingerprint);
    if (!session) {
      // Unknown/forged token — no family to revoke.
      throw sessionInvalid();
    }
    if (session.isRevoked) {
      throw sessionInvalid();
    }

    const actorId = session.actorType === 'ORGANIZATION' ? session.organizationId : session.userId;

    // A3 — REUSE DETECTION, checked BEFORE expiry so a replayed-but-live
    // token still burns the whole family (design DD2 ordering).
    if (session.rotatedAt !== null) {
      await deps.sessions.revokeFamily(session.familyId, now);
      await emitBestEffort({
        organizationId: session.organizationId,
        actorType: session.actorType,
        actorId,
        action: 'SESSION_REUSE_DETECTED',
        resource: 'sessions',
        resourceId: null,
        detail: { familyId: session.familyId, sessionId: session.id, reason: 'ALREADY_ROTATED' },
        ipAddress: input.ipAddress ?? null,
      });
      throw sessionInvalid();
    }

    // A4 — natural expiry. Rejected WITHOUT a family revoke — an expired
    // token is not theft.
    if (session.refreshExpiresAt === null || toDate(session.refreshExpiresAt) <= toDate(now)) {
      throw sessionInvalid();
    }
    if (toDate(session.familyExpiresAt) <= toDate(now)) {
      throw sessionInvalid();
    }

    // B — atomic rotation.
    return deps.unitOfWork.withTransaction(async (tx) => {
      const won = await deps.sessions.markRotated(session.id, now, tx);
      if (!won) {
        // CAS lost: a concurrent refresh already rotated this exact row —
        // two presentations of the same refresh token. Treated as reuse
        // (design DD2/DD10 — no grace window). `revokeFamily` is unsessioned
        // (design D16) so it survives this transaction's own rollback.
        await deps.sessions.revokeFamily(session.familyId, now);
        await emitBestEffort({
          organizationId: session.organizationId,
          actorType: session.actorType,
          actorId,
          action: 'SESSION_REUSE_DETECTED',
          resource: 'sessions',
          resourceId: null,
          detail: { familyId: session.familyId, sessionId: session.id, reason: 'CAS_LOST' },
          ipAddress: input.ipAddress ?? null,
        });
        throw sessionInvalid();
      }

      const minted = await deps.issueSessionFor({
        userId: session.userId,
        organizationId: session.organizationId,
        actorType: session.actorType,
        now,
        tx,
        rotation: {
          familyId: session.familyId,
          familyExpiresAt: session.familyExpiresAt,
          rotatedFromSessionId: session.id,
        },
      });

      await deps.auditRecorder.record(
        {
          organizationId: session.organizationId,
          actorType: session.actorType,
          actorId,
          action: 'SESSION_REFRESHED',
          resource: 'sessions',
          resourceId: null,
          detail: { familyId: session.familyId, rotatedFrom: session.id },
          ipAddress: input.ipAddress ?? null,
        },
        tx,
      );

      return minted;
    });
  };
}
