import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { UserRepositoryFactory } from '../domain/ports/UserRepositoryFactory.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { RoleRepository } from '../domain/ports/RoleRepository.js';
import type { User } from '../domain/model/aggregates/User.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../domain/model/value-objects/UserId.js';
import { createRoleId } from '../domain/model/value-objects/RoleId.js';
import { userNotFound, roleNotAssignable } from '../domain/errors/IdentityAccessError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireUserRole, USER_MANAGE_ROLES } from './authorization/requireUserRole.js';

export interface ChangeUserRoleInput {
  readonly auth: AuthContext;
  readonly userId: string;
  /** Raw wire value (request key `role`), validated via `RoleRepository.isAssignableToUser`. */
  readonly roleId: string;
}

export interface ChangeUserRoleDeps {
  readonly userRepositoryFactory: UserRepositoryFactory;
  readonly roleRepository: RoleRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly auditRecorder: AuditRecorder;
}

/**
 * Organization-Only Role Change (user-roles PR-2 spec "Organization-Only
 * Role Change", design "6. `ChangeUserRole` use case") — mirrors
 * `TransitionUserStatus`'s transactional-mutate-plus-audit shape. Only an
 * `ORGANIZATION`-tier actor may change a user's role, and only within the
 * caller's own tenant (tenant isolation gives NOT_FOUND for unknown AND
 * cross-tenant ids alike, no existence leak).
 */
export function createChangeUserRoleUseCase(deps: ChangeUserRoleDeps) {
  return async function changeUserRole(input: ChangeUserRoleInput): Promise<User> {
    // role-authorization: ORGANIZATION or USER with ADMIN role may change roles.
    await requireUserRole(input.auth, deps.userRepositoryFactory, USER_MANAGE_ROLES, 'change user roles');
    const organizationId = createOrganizationId(requireTenantContext(input.auth));
    const repository = deps.userRepositoryFactory.forTenant(organizationId);

    const roleId = createRoleId(input.roleId);
    if (!(await deps.roleRepository.isAssignableToUser(roleId))) {
      throw roleNotAssignable(input.roleId);
    }

    return deps.unitOfWork.withTransaction(async (tx) => {
      const id = createUserId(input.userId);
      const user = await repository.findById(id);
      if (!user) {
        throw userNotFound(input.userId);
      }

      const from = user.roleId;
      const changed = user.changeRole(roleId, deps.clock.now());
      await repository.save(changed, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'USER_ROLE_CHANGED',
          resource: 'users',
          resourceId: id,
          detail: { from, to: roleId },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return changed;
    });
  };
}
