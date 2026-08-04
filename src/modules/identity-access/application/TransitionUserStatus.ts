import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { UserRepositoryFactory } from '../domain/ports/UserRepositoryFactory.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { User } from '../domain/model/aggregates/User.js';
import type { LifecycleStatus } from '../domain/model/value-objects/LifecycleStatus.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../domain/model/value-objects/UserId.js';
import { createTransitionActor } from '../domain/model/value-objects/TransitionActor.js';
import { userNotFound } from '../domain/errors/IdentityAccessError.js';

export interface TransitionUserStatusInput {
  readonly auth: AuthContext;
  readonly userId: string;
  readonly next: LifecycleStatus;
}

export interface TransitionUserStatusDeps {
  readonly userRepositoryFactory: UserRepositoryFactory;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

/**
 * Backs both `POST /users/:id/transition` and `DELETE /users/:id`
 * (user-lifecycle spec: "Soft Delete as Status Transition"). No
 * `requirePlatformAdmin` gate here (users routes are tenant-scoped, not
 * platform-admin-gated) — the reactivation gate below is independent
 * defense-in-depth at the domain level (design D2).
 */
export function createTransitionUserStatusUseCase(deps: TransitionUserStatusDeps) {
  return async function transitionUserStatus(input: TransitionUserStatusInput): Promise<User> {
    const repository = deps.userRepositoryFactory.forTenant(createOrganizationId(input.auth.organizationId));

    return deps.unitOfWork.withTransaction(async () => {
      const id = createUserId(input.userId);
      const user = await repository.findById(id);
      if (!user) {
        throw userNotFound(input.userId);
      }

      const actor = createTransitionActor(input.auth.isPlatformAdmin);
      const transitioned = user.transitionTo(input.next, actor, deps.clock.now());
      await repository.save(transitioned);
      return transitioned;
    });
  };
}
