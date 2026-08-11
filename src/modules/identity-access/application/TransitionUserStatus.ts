import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { UserRepositoryFactory } from '../domain/ports/UserRepositoryFactory.js';
import type { SessionRepository } from '../domain/ports/SessionRepository.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { User } from '../domain/model/aggregates/User.js';
import type { LifecycleStatus } from '../domain/model/value-objects/LifecycleStatus.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../domain/model/value-objects/UserId.js';
import { createTransitionActor } from '../domain/model/value-objects/TransitionActor.js';
import { userNotFound } from '../domain/errors/IdentityAccessError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface TransitionUserStatusInput {
  readonly auth: AuthContext;
  readonly userId: string;
  readonly next: LifecycleStatus;
}

export interface TransitionUserStatusDeps {
  readonly userRepositoryFactory: UserRepositoryFactory;
  /** NEW (session-lifecycle PR-1): revokes sessions on DISABLED. */
  readonly sessions: SessionRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  /** NEW (audit-logs-foundation Phase 5): emits USER_STATUS_CHANGED. */
  readonly auditRecorder: AuditRecorder;
}

/**
 * Backs both `POST /users/:id/transition` and `DELETE /users/:id`
 * (user-lifecycle spec: "Soft Delete as Status Transition"). No
 * `requirePlatformAdmin` gate here (users routes are tenant-scoped, not
 * platform-admin-gated) — the reactivation gate below is independent
 * defense-in-depth at the domain level (design D2).
 *
 * audit-logs-foundation Phase 5: NOW BINDS `tx` (previously the transaction
 * callback param was dropped — `withTransaction(async () => {...})` — so
 * `repository.save` never actually ran inside the opened transaction) and
 * threads it to `repository.save` and the audit emission, so the status
 * change and the `USER_STATUS_CHANGED` audit row commit or roll back
 * together (spec "Atomic Emission").
 */
export function createTransitionUserStatusUseCase(deps: TransitionUserStatusDeps) {
  return async function transitionUserStatus(input: TransitionUserStatusInput): Promise<User> {
    const organizationId = createOrganizationId(requireTenantContext(input.auth));
    const repository = deps.userRepositoryFactory.forTenant(organizationId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const id = createUserId(input.userId);
      const user = await repository.findById(id);
      if (!user) {
        throw userNotFound(input.userId);
      }

      const actor = createTransitionActor(input.auth.isPlatformAdmin);
      const from = user.status;
      const now = deps.clock.now();
      const transitioned = user.transitionTo(input.next, actor, now);
      await repository.save(transitioned, tx);

      if (input.next === 'DISABLED') {
        const revokedCount = await deps.sessions.revokeAllForActor({ actorType: 'USER', userId: id }, now, tx);
        await deps.auditRecorder.record(
          {
            organizationId,
            actorType: input.auth.actorType,
            actorId: input.auth.userId,
            action: 'USER_SESSIONS_REVOKED',
            resource: 'sessions',
            resourceId: null,
            detail: { revokedCount },
            ipAddress: input.auth.ipAddress,
          },
          tx,
        );
      }

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'USER_STATUS_CHANGED',
          resource: 'users',
          resourceId: id,
          detail: { from, to: input.next },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return transitioned;
    });
  };
}
