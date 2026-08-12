import type { Clock } from '../../../../shared/time/Clock.js';
import { toDate } from '../../../../shared/time/Instant.js';
import type { SessionTokenService } from '../../domain/ports/SessionTokenService.js';
import type { UserRepositoryFactory } from '../../domain/ports/UserRepositoryFactory.js';
import type { PasswordHasher } from '../../domain/ports/PasswordHasher.js';
import type { SessionRepository } from '../../domain/ports/SessionRepository.js';
import type { UnitOfWork } from '../../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../../domain/ports/AuditRecorder.js';
import { createOrganizationId } from '../../domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../domain/model/value-objects/UserId.js';
import { createPasswordCredential } from '../../domain/model/value-objects/PasswordCredential.js';
import { passwordResetInvalid } from '../../domain/errors/IdentityAccessError.js';
import { assertPasswordPolicy } from '../../domain/model/value-objects/PasswordPolicy.js';

export interface ConfirmPasswordResetInput {
  readonly token: string;
  readonly newPassword: string;
  readonly ipAddress?: string | null;
}

export interface ConfirmPasswordResetDeps {
  readonly sessionTokenService: SessionTokenService;
  readonly userRepositoryFactory: UserRepositoryFactory;
  readonly passwordHasher: PasswordHasher;
  readonly sessions: SessionRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly auditRecorder: AuditRecorder;
}

/**
 * Confirm Password Reset (unauthenticated, token-only, password-management
 * PR-2c, spec "Confirm Password Reset"). No `organizationSlug` in the input
 * — the tenant is entirely derived from the token's `organizationId` claim
 * (design §2: `password_reset` tokens always carry an already-resolved
 * user+tenant pair, unlike the mfa arms).
 *
 * Mirrors `IssueSession`'s verify-before-transact shape (design §3): every
 * rejection path (malformed/undecryptable token, wrong `tokenType`, expired
 * claim, unknown user, stale/mismatched/already-cleared `resetToken`) is
 * checked BEFORE the transaction opens, and every one of them throws the
 * SAME opaque `passwordResetInvalid()` (design "Errors" — no enumeration
 * oracle). Success then runs, in ONE `unitOfWork.withTransaction`:
 * hash-new-password -> `completePasswordReset` (replaces the credential AND
 * clears `resetToken` atomically, the single-use pivot) -> save ->
 * `revokeAllForActor` (a reset implies compromise, so every session dies,
 * not just the current one — there IS no "current session" here, the
 * caller is unauthenticated) -> `PASSWORD_RESET_COMPLETED` audit, all
 * in-tx. A replayed token finds `resetToken` already `null` (or holding a
 * different jti's hash from a LATER request) and is rejected by the
 * pre-transaction check, so it never even reaches the transaction.
 */
export function createConfirmPasswordResetUseCase(deps: ConfirmPasswordResetDeps) {
  return async function confirmPasswordReset(input: ConfirmPasswordResetInput): Promise<void> {
    const now = deps.clock.now();

    const payload = deps.sessionTokenService.read(input.token);
    if (!payload || payload.tokenType !== 'password_reset') {
      throw passwordResetInvalid();
    }
    if (new Date(payload.expiresAt).getTime() <= toDate(now).getTime()) {
      throw passwordResetInvalid();
    }

    const organizationId = createOrganizationId(payload.organizationId);
    const repository = deps.userRepositoryFactory.forTenant(organizationId);
    const user = await repository.findById(createUserId(payload.userId));
    if (!user) {
      throw passwordResetInvalid();
    }

    const resetToken = user.resetToken;
    if (!resetToken) {
      throw passwordResetInvalid();
    }
    if (resetToken.hash !== deps.sessionTokenService.fingerprint(payload.jti)) {
      throw passwordResetInvalid();
    }
    if (toDate(resetToken.expiresAt).getTime() <= toDate(now).getTime()) {
      throw passwordResetInvalid();
    }

    // Strength policy is enforced only AFTER every opaque token/user check
    // passes — a WEAK_PASSWORD response is distinguishable, so surfacing it
    // earlier would leak that the token/user was otherwise valid.
    assertPasswordPolicy(input.newPassword);

    await deps.unitOfWork.withTransaction(async (tx) => {
      const newCredential = createPasswordCredential(
        (await deps.passwordHasher.hash(input.newPassword)).passwordHash,
      );
      const completed = user.completePasswordReset(newCredential, now);
      await repository.save(completed, tx);

      await deps.sessions.revokeAllForActor({ actorType: 'USER', userId: user.id }, now, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: 'USER',
          actorId: user.id,
          action: 'PASSWORD_RESET_COMPLETED',
          resource: 'users',
          resourceId: user.id,
          detail: {},
          ipAddress: input.ipAddress ?? null,
        },
        tx,
      );
    });
  };
}
