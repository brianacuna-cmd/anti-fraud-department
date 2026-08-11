import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../../shared/time/Clock.js';
import type { SessionRepository } from '../../domain/ports/SessionRepository.js';
import type { AuditRecorder, AuditEvent } from '../../domain/ports/AuditRecorder.js';
import { createSessionId } from '../../domain/model/value-objects/SessionId.js';
import { createOrganizationId } from '../../domain/model/value-objects/OrganizationId.js';

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
 * Sets `deletedAt` on the CURRENT session only, for a USER (or any
 * non-ORGANIZATION tier) actor (authentication-session spec: "Logout and
 * Session Validation") — never the whole family (that is `revokeFamily`'s
 * job, reserved for reuse detection, design D16). `AuthContext.sessionId` is
 * `null` under `AUTH_MODE=trusted-header` (design D4/D11 — no real
 * `Sessions` row backs that resolver), so this is a deliberate no-op rather
 * than an error in that mode.
 *
 * session-lifecycle PR-1 (design "5. Logout actorType branch", DD6):
 * DELIBERATE BEHAVIOR CHANGE — an ORGANIZATION actor now revokes EVERY
 * session belonging to that organization, not just the current one. Before
 * `IssueOrganizationSession` shipped, ORG logout was always a no-op (no real
 * ORG session existed yet), so this changes observable behavior the moment
 * ORG login starts minting real sessions.
 */
export function createLogoutUseCase(deps: LogoutDeps) {
  return async function logout(input: LogoutInput): Promise<void> {
    if (input.auth.sessionId === null) {
      return;
    }
    const now = deps.clock.now();
    if (input.auth.actorType === 'ORGANIZATION' && input.auth.organizationId !== null) {
      await deps.sessions.revokeAllForOrganization(createOrganizationId(input.auth.organizationId), now);
    } else {
      await deps.sessions.revokeSession(createSessionId(input.auth.sessionId), now);
    }

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
