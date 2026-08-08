import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { UserRepositoryFactory } from '../domain/ports/UserRepositoryFactory.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { User } from '../domain/model/aggregates/User.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../domain/model/value-objects/UserId.js';
import { createEmail } from '../domain/model/value-objects/Email.js';
import { userNotFound, userEmailTaken } from '../domain/errors/IdentityAccessError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface PatchUserIdentityInput {
  readonly auth: AuthContext;
  readonly userId: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly email?: string;
  readonly middleName?: string | null;
  readonly avatarUrl?: string | null;
}

export interface PatchUserIdentityDeps {
  readonly userRepositoryFactory: UserRepositoryFactory;
  /** NEW (audit-logs-foundation Phase 5): wraps the write in a transaction so the USER_IDENTITY_UPDATED audit row commits atomically with it. */
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  /** NEW (audit-logs-foundation Phase 5): emits USER_IDENTITY_UPDATED. */
  readonly auditRecorder: AuditRecorder;
}

/**
 * User Identity Patch (user-lifecycle spec) — only firstName/lastName/email/avatarUrl.
 *
 * audit-logs-foundation Phase 5: NOW wrapped in `UnitOfWork.withTransaction`
 * (previously a single-write use case with no transaction at all) so the
 * write and the `USER_IDENTITY_UPDATED` audit row commit or roll back
 * together (spec "Atomic Emission").
 */
export function createPatchUserIdentityUseCase(deps: PatchUserIdentityDeps) {
  return async function patchUserIdentity(input: PatchUserIdentityInput): Promise<User> {
    const organizationId = createOrganizationId(requireTenantContext(input.auth));
    const repository = deps.userRepositoryFactory.forTenant(organizationId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const id = createUserId(input.userId);
      const user = await repository.findById(id);
      if (!user) {
        throw userNotFound(input.userId);
      }

      const email = input.email === undefined ? undefined : createEmail(input.email);
      if (email !== undefined && email !== user.email) {
        const conflicting = await repository.findByEmail(email);
        if (conflicting) {
          throw userEmailTaken(input.email!);
        }
      }

      const updated = user.patchIdentity(
        {
          firstName: input.firstName,
          lastName: input.lastName,
          email,
          middleName: input.middleName,
          avatarUrl: input.avatarUrl,
        },
        deps.clock.now(),
      );
      await repository.save(updated, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'USER_IDENTITY_UPDATED',
          resource: 'users',
          resourceId: id,
          detail: { firstName: updated.firstName, lastName: updated.lastName, email: updated.email },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return updated;
    });
  };
}
