import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { UserRepositoryFactory } from '../domain/ports/UserRepositoryFactory.js';
import type { PasswordHasher } from '../domain/ports/PasswordHasher.js';
import type { SessionRepository } from '../domain/ports/SessionRepository.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { User } from '../domain/model/aggregates/User.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../domain/model/value-objects/UserId.js';
import { createPasswordCredential } from '../domain/model/value-objects/PasswordCredential.js';
import { userNotFound, invalidCurrentPassword } from '../domain/errors/IdentityAccessError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface ChangePasswordInput {
  readonly auth: AuthContext;
  readonly currentPassword: string;
  readonly newPassword: string;
}

export interface ChangePasswordDeps {
  readonly userRepositoryFactory: UserRepositoryFactory;
  readonly passwordHasher: PasswordHasher;
  readonly sessions: SessionRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly auditRecorder: AuditRecorder;
}

/**
 * Change Password (authenticated, password-management PR-1, spec "Change
 * Password"). Mirrors `DisableMfa`/`RevokeAdminKey`: load -> verify ->
 * mutate -> save -> revoke-all-sessions -> audit, all inside ONE
 * `unitOfWork.withTransaction`. Verification failure throws BEFORE any
 * write happens (no `save`/`revokeAllForActor`/`record` call is ever
 * reached), so a mismatched current password leaves state untouched even
 * though the transaction technically opened. Success revokes EVERY one of
 * the user's sessions, including the one making this very request (design
 * "Single-use + atomicity" — password change implies "start fresh").
 */
export function createChangePasswordUseCase(deps: ChangePasswordDeps) {
  return async function changePassword(input: ChangePasswordInput): Promise<User> {
    const organizationId = createOrganizationId(requireTenantContext(input.auth));
    const repository = deps.userRepositoryFactory.forTenant(organizationId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const userId = createUserId(input.auth.userId);
      const user = await repository.findById(userId);
      if (!user) {
        throw userNotFound(input.auth.userId);
      }

      const verified = await deps.passwordHasher.verify(input.currentPassword, user.credential);
      if (!verified) {
        throw invalidCurrentPassword();
      }

      const now = deps.clock.now();
      const newCredential = createPasswordCredential((await deps.passwordHasher.hash(input.newPassword)).passwordHash);

      const changed = user.changeCredential(newCredential, now);
      await repository.save(changed, tx);

      await deps.sessions.revokeAllForActor({ actorType: 'USER', userId: user.id }, now, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'PASSWORD_CHANGED',
          resource: 'users',
          resourceId: userId,
          detail: {},
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return changed;
    });
  };
}
