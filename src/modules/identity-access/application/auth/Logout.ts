import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../../shared/time/Clock.js';
import type { SessionRepository } from '../../domain/ports/SessionRepository.js';
import type { AuditRecorder, AuditEvent } from '../../domain/ports/AuditRecorder.js';
import { createSessionId } from '../../domain/model/value-objects/SessionId.js';

export interface LogoutInput {
  readonly auth: AuthContext;
}

export interface LogoutDeps {
  readonly sessions: SessionRepository;
  readonly clock: Clock;
  /** Emits LOGOUT audit events (best-effort, consistent with the login path). */
  readonly auditRecorder: AuditRecorder;
}

/**
 * Sets `deletedAt` on the CURRENT session only (authentication-session spec:
 * "Logout and Session Validation") — never the whole family (that is
 * `revokeFamily`'s job, reserved for reuse detection, design D16).
 * `AuthContext.sessionId` is `null` under `AUTH_MODE=trusted-header` (design
 * D4/D11 — no real `Sessions` row backs that resolver), so this is a
 * deliberate no-op rather than an error in that mode.
 */
export function createLogoutUseCase(deps: LogoutDeps) {
  return async function logout(input: LogoutInput): Promise<void> {
    if (input.auth.sessionId === null) {
      return;
    }
    await deps.sessions.revokeSession(createSessionId(input.auth.sessionId), deps.clock.now());

    const event: AuditEvent = {
      organizationId: input.auth.organizationId,
      actorType: input.auth.actorType,
      actorId: input.auth.userId,
      action: 'LOGOUT',
      resource: 'sessions',
      resourceId: input.auth.sessionId,
      detail: {},
      ipAddress: input.auth.ipAddress,
    };
    try {
      // Best-effort, consistent with the login path: a failed audit write must
      // not turn a completed logout into an error the client would retry.
      await deps.auditRecorder.record(event);
    } catch {
      // swallow — logout already succeeded
    }
  };
}
