import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { UserRepositoryFactory } from '../domain/ports/UserRepositoryFactory.js';
import type { PasswordHasher } from '../domain/ports/PasswordHasher.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { RoleRepository } from '../domain/ports/RoleRepository.js';
import type { UserId } from '../domain/model/value-objects/UserId.js';
import { User } from '../domain/model/aggregates/User.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { createEmail } from '../domain/model/value-objects/Email.js';
import { createRoleId } from '../domain/model/value-objects/RoleId.js';
import { userEmailTaken, roleNotAssignable } from '../domain/errors/IdentityAccessError.js';
import { assertPasswordPolicy } from '../domain/model/value-objects/PasswordPolicy.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireUserRole, USER_MANAGE_ROLES } from './authorization/requireUserRole.js';

export interface CreateUserInput {
  readonly auth: AuthContext;
  readonly email: string;
  readonly password: string;
  readonly firstName: string;
  readonly middleName?: string | null;
  readonly lastName: string;
  readonly avatarUrl?: string | null;
  /** user-roles PR-1b: raw wire value, required — validated via `RoleRepository.isAssignableToUser`. */
  readonly roleId: string;
}

export interface CreateUserDeps {
  readonly userRepositoryFactory: UserRepositoryFactory;
  readonly passwordHasher: PasswordHasher;
  /** NEW (audit-logs-foundation Phase 5): wraps the write in a transaction so the USER_CREATED audit row commits atomically with it. */
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateId: () => UserId;
  /** NEW (audit-logs-foundation Phase 5): emits USER_CREATED. */
  readonly auditRecorder: AuditRecorder;
  /** NEW (user-roles PR-1b): validates the requested role is an existing, Active, user-assignable role. */
  readonly roleRepository: RoleRepository;
}

/**
 * Tenant-Scoped, Organization-Only User Creation (user-lifecycle spec,
 * user-roles PR-1b spec "Organization-Only Role Assignment on User
 * Creation") — every user is created inside the caller's OWN organization,
 * and the caller MUST be an `ORGANIZATION`-tier actor (design "5. `CreateUser`
 * use case changes" — `requireOrganizationActor` replaces the previous
 * tenant-only gate for this specific route).
 *
 * audit-logs-foundation Phase 5: wrapped in `UnitOfWork.withTransaction`
 * (previously a single-write use case with no transaction at all) so the
 * `User` write and the `USER_CREATED` audit row commit or roll back together
 * (spec "Atomic Emission").
 */
export function createCreateUserUseCase(deps: CreateUserDeps) {
  return async function createUser(input: CreateUserInput): Promise<User> {
    // role-authorization: ORGANIZATION or USER with ADMIN role may create users.
    await requireUserRole(input.auth, deps.userRepositoryFactory, USER_MANAGE_ROLES, 'create users');
    assertPasswordPolicy(input.password);
    const organizationId = createOrganizationId(requireTenantContext(input.auth));
    const repository = deps.userRepositoryFactory.forTenant(organizationId);

    const roleId = createRoleId(input.roleId);
    if (!(await deps.roleRepository.isAssignableToUser(roleId))) {
      throw roleNotAssignable(input.roleId);
    }

    return deps.unitOfWork.withTransaction(async (tx) => {
      const email = createEmail(input.email);
      const existing = await repository.findByEmail(email);
      if (existing) {
        throw userEmailTaken(input.email);
      }

      const credential = await deps.passwordHasher.hash(input.password);

      const user = User.create({
        id: deps.generateId(),
        organizationId,
        email,
        credential,
        firstName: input.firstName,
        middleName: input.middleName,
        lastName: input.lastName,
        avatarUrl: input.avatarUrl,
        roleId,
        now: deps.clock.now(),
      });

      await repository.save(user, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'USER_CREATED',
          resource: 'users',
          resourceId: user.id,
          detail: { email: user.email, firstName: user.firstName, lastName: user.lastName, roleId: user.roleId },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return user;
    });
  };
}
