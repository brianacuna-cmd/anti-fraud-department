import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { UserRepositoryFactory } from '../domain/ports/UserRepositoryFactory.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { TotpService } from '../domain/ports/TotpService.js';
import type { SecretCipher } from '../domain/ports/SecretCipher.js';
import type { MfaChallengeStore } from '../domain/ports/MfaChallengeStore.js';
import type { User } from '../domain/model/aggregates/User.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../domain/model/value-objects/UserId.js';
import { userNotFound, mfaEnrollmentNotPending, mfaTokenInvalid, mfaChallengeInvalid } from '../domain/errors/IdentityAccessError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import type { createSessionIssuer, MintedSession } from './auth/SessionIssuer.js';

export interface ActivateMfaInput {
  readonly auth: AuthContext;
  readonly token: string;
}

export interface ActivateMfaResult {
  readonly user: User;
  /**
   * Non-null ONLY for the forced-enrollment hand-off (`auth.purpose ===
   * 'enrollment'`, design D4) — a self-service caller (`auth.purpose ===
   * 'full'`) already HAS a session, so no second one is minted.
   */
  readonly session: MintedSession | null;
}

export interface ActivateMfaDeps {
  readonly userRepositoryFactory: UserRepositoryFactory;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly totpService: TotpService;
  readonly secretCipher: SecretCipher;
  readonly auditRecorder: AuditRecorder;
  readonly mfaChallenges: MfaChallengeStore;
  readonly issueSessionFor: ReturnType<typeof createSessionIssuer>;
}

/**
 * Confirms a pending MFA enrollment for the AUTHENTICATED user
 * (mfa-user-enrollment PR2). Decrypts the pending secret set by `SetupMfa`,
 * verifies the submitted TOTP `token` against it, and only THEN flips
 * `enabled=true` -- a wrong/expired token never enables MFA. Emits
 * `MFA_ENABLED` atomically with the write (same `withTransaction` + `tx`
 * threading shape as `TransitionUserStatus`).
 *
 * two-step-login PR3 (design D4, "Enrollment hand-off"): DUAL-MODE. A
 * `'full'`-scope caller (self-service re-activation) behaves exactly as
 * before -- `session` comes back `null`. An `'enrollment'`-scope caller
 * (forced enrollment, `auth.mfaJti` set by the resolver) additionally
 * consumes its single-use `mfa_enrollment` jti and mints a full session via
 * the SAME `SessionIssuer` `IssueSession` uses -- both inside this ONE
 * transaction. `consume` runs FIRST, immediately before minting (identical
 * consume-before-mint ordering to `IssueSession`): a replayed/expired/
 * unknown jti throws before any session is minted, and the whole
 * transaction (including the `confirmMfaEnrollment` write) rolls back with
 * it -- an enrollment token is never partially spent.
 */
export function createActivateMfaUseCase(deps: ActivateMfaDeps) {
  return async function activateMfa(input: ActivateMfaInput): Promise<ActivateMfaResult> {
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

      let session: MintedSession | null = null;
      if (input.auth.purpose === 'enrollment') {
        if (!input.auth.mfaJti) {
          throw mfaChallengeInvalid();
        }
        const now = deps.clock.now();
        const consumed = await deps.mfaChallenges.consume(input.auth.mfaJti, now, tx);
        if (!consumed) {
          throw mfaChallengeInvalid();
        }
        session = await deps.issueSessionFor({
          userId: confirmed.id,
          organizationId,
          ipAddress: input.auth.ipAddress,
          now,
          tx,
        });
      }

      return { user: confirmed, session };
    });
  };
}
