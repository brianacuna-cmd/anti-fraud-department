import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { UserRepositoryFactory } from '../domain/ports/UserRepositoryFactory.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { TotpService } from '../domain/ports/TotpService.js';
import type { SecretCipher } from '../domain/ports/SecretCipher.js';
import type { User } from '../domain/model/aggregates/User.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../domain/model/value-objects/UserId.js';
import { userNotFound, mfaEnrollmentNotPending, mfaTokenInvalid } from '../domain/errors/IdentityAccessError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface ActivateMfaInput {
  readonly auth: AuthContext;
  readonly token: string;
}

export interface ActivateMfaDeps {
  readonly userRepositoryFactory: UserRepositoryFactory;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly totpService: TotpService;
  readonly secretCipher: SecretCipher;
  readonly auditRecorder: AuditRecorder;
}

/**
 * Confirms a pending MFA enrollment for the AUTHENTICATED user
 * (mfa-user-enrollment PR2). Decrypts the pending secret set by `SetupMfa`,
 * verifies the submitted TOTP `token` against it, and only THEN flips
 * `enabled=true` — a wrong/expired token never enables MFA. Emits
 * `MFA_ENABLED` atomically with the write (same `withTransaction` + `tx`
 * threading shape as `TransitionUserStatus`).
 */
export function createActivateMfaUseCase(deps: ActivateMfaDeps) {
  return async function activateMfa(input: ActivateMfaInput): Promise<User> {
    const organizationId = createOrganizationId(requireTenantContext(input.auth));
    const repository = deps.userRepositoryFactory.forTenant(organizationId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const userId = createUserId(input.auth.userId);
      const user = await repository.findById(userId);
      if (!user) {
        throw userNotFound(input.auth.userId);
      }

      if (user.mfa.secret === null) {
        throw mfaEnrollmentNotPending();
      }

      const plaintextSecret = deps.secretCipher.decrypt(user.mfa.secret);
      if (!plaintextSecret || !deps.totpService.verify(input.token, plaintextSecret)) {
        throw mfaTokenInvalid();
      }

      const confirmed = user.confirmMfaEnrollment(deps.clock.now());
      await repository.save(confirmed, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'MFA_ENABLED',
          resource: 'users',
          resourceId: userId,
          detail: {},
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return confirmed;
    });
  };
}
