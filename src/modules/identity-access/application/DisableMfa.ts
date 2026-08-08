import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { UserRepositoryFactory } from '../domain/ports/UserRepositoryFactory.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { User } from '../domain/model/aggregates/User.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../domain/model/value-objects/UserId.js';
import { userNotFound } from '../domain/errors/IdentityAccessError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface DisableMfaInput {
  readonly auth: AuthContext;
}

export interface DisableMfaDeps {
  readonly userRepositoryFactory: UserRepositoryFactory;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly auditRecorder: AuditRecorder;
}

/**
 * Disables MFA for the AUTHENTICATED user (mfa-user-enrollment PR2) —
 * clears the stored (encrypted) secret and flips `enabled=false`, whether
 * MFA was enabled, still pending, or already off (`User#disableMfa` is
 * idempotent). Emits `MFA_DISABLED` atomically with the write.
 */
export function createDisableMfaUseCase(deps: DisableMfaDeps) {
  return async function disableMfa(input: DisableMfaInput): Promise<User> {
    const organizationId = createOrganizationId(requireTenantContext(input.auth));
    const repository = deps.userRepositoryFactory.forTenant(organizationId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const userId = createUserId(input.auth.userId);
      const user = await repository.findById(userId);
      if (!user) {
        throw userNotFound(input.auth.userId);
      }

      const disabled = user.disableMfa(deps.clock.now());
      await repository.save(disabled, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'MFA_DISABLED',
          resource: 'users',
          resourceId: userId,
          detail: {},
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return disabled;
    });
  };
}
