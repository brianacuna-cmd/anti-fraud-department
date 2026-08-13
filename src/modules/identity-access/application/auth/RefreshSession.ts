import type { Clock } from '../../../../shared/time/Clock.js';
import { toDate } from '../../../../shared/time/Instant.js';
import type { SessionTokenService } from '../../domain/ports/SessionTokenService.js';
import type { SessionRepository } from '../../domain/ports/SessionRepository.js';
import type { UnitOfWork } from '../../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../../domain/ports/AuditRecorder.js';
import { createSessionId } from '../../domain/model/value-objects/SessionId.js';
import { sessionInvalid } from '../../domain/errors/IdentityAccessError.js';
import type { createSessionIssuer, MintedSession } from './SessionIssuer.js';

export interface RefreshSessionInput {
  readonly refreshToken: string;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
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
 * `POST /auth/refresh`: the REFRESH token is a pointer (`sessionId`) only —
 * it is not stored. The live row is loaded by id, revoked, and a new access
 * session is minted. There is no rotation family.
 */
export function createRefreshSessionUseCase(deps: RefreshSessionDeps) {
  return async function refreshSession(input: RefreshSessionInput): Promise<RefreshSessionResult> {
    const now = deps.clock.now();

    const payload = deps.sessionTokenService.read(input.refreshToken);
    if (!payload || payload.tokenType !== 'REFRESH') {
      throw sessionInvalid();
    }
    if (!('sessionId' in payload) || typeof payload.sessionId !== 'string') {
      throw sessionInvalid();
    }

    let sessionId;
    try {
      sessionId = createSessionId(payload.sessionId);
    } catch {
      throw sessionInvalid();
    }

    const session = await deps.sessions.findById(sessionId);
    if (!session || session.isRevoked) {
      throw sessionInvalid();
    }
    if (toDate(session.expiresAt) <= toDate(now)) {
      throw sessionInvalid();
    }

    const actorId =
      session.actorType === 'ORGANIZATION'
        ? session.organizationId
        : session.actorType === 'PLATFORM_ADMIN'
          ? session.adminOrganizationId
          : session.userId;

    return deps.unitOfWork.withTransaction(async (tx) => {
      await deps.sessions.revokeSession(session.id, now, tx);

      const minted = await deps.issueSessionFor({
        userId: session.userId,
        organizationId: session.organizationId,
        adminOrganizationId: session.adminOrganizationId,
        ipAddress: input.ipAddress ?? session.ipAddress,
        userAgent: input.userAgent ?? session.userAgent,
        now,
        tx,
      });

      await deps.auditRecorder.record(
        {
          organizationId: session.organizationId,
          actorType: session.actorType,
          actorId,
          action: 'SESSION_REFRESHED',
          resource: 'sessions',
          resourceId: null,
          detail: { refreshedFrom: session.id },
          ipAddress: input.ipAddress ?? null,
        },
        tx,
      );

      return minted;
    });
  };
}
