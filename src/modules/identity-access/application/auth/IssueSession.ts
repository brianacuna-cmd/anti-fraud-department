import type { Clock } from '../../../../shared/time/Clock.js';
import { toDate } from '../../../../shared/time/Instant.js';
import type { SessionTokenService } from '../../domain/ports/SessionTokenService.js';
import type { MfaChallengeStore } from '../../domain/ports/MfaChallengeStore.js';
import type { UserRepositoryFactory } from '../../domain/ports/UserRepositoryFactory.js';
import type { TotpService } from '../../domain/ports/TotpService.js';
import type { SecretCipher } from '../../domain/ports/SecretCipher.js';
import type { UnitOfWork } from '../../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../../domain/ports/AuditRecorder.js';
import { createOrganizationId } from '../../domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../domain/model/value-objects/UserId.js';
import { mfaChallengeInvalid, mfaTokenInvalid } from '../../domain/errors/IdentityAccessError.js';
import type { createSessionIssuer, MintedSession } from './SessionIssuer.js';

export interface IssueSessionInput {
  readonly challengeToken: string;
  readonly totp: string;
  readonly ipAddress?: string | null;
}

export type IssueSessionResult = MintedSession;

export interface IssueSessionDeps {
  readonly sessionTokenService: SessionTokenService;
  readonly mfaChallenges: MfaChallengeStore;
  readonly userRepositoryFactory: UserRepositoryFactory;
  readonly totpService: TotpService;
  readonly secretCipher: SecretCipher;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly issueSessionFor: ReturnType<typeof createSessionIssuer>;
  readonly auditRecorder: AuditRecorder;
}

/**
 * Step-2 challenge-path use case, `POST /auth/{tier}/mfa` (design "IssueSession
 * flow"). Verifies the `mfa_challenge` token's shape/type/self-expiry and the
 * submitted TOTP BEFORE opening a transaction — a wrong TOTP must never
 * consume the jti (spec: "challenge token remains valid for retry within
 * TTL"). Inside the transaction, `consume` runs FIRST: a replay/expired/
 * unknown-jti loser throws before `SessionIssuer` mints anything, so no
 * second `Sessions` row is ever created for an already-spent challenge.
 */
export function createIssueSessionUseCase(deps: IssueSessionDeps) {
  return async function issueSession(input: IssueSessionInput): Promise<IssueSessionResult> {
    const now = deps.clock.now();

    const payload = deps.sessionTokenService.read(input.challengeToken);
    if (!payload || payload.tokenType !== 'mfa_challenge') {
      throw mfaChallengeInvalid();
    }
    if (new Date(payload.expiresAt).getTime() <= toDate(now).getTime()) {
      throw mfaChallengeInvalid();
    }
    if (payload.organizationId === null) {
      // USER-tier challenges always carry a real organizationId (design
      // D-A11) — null here means a tampered/malformed claim.
      throw mfaChallengeInvalid();
    }

    const organizationId = createOrganizationId(payload.organizationId);
    const repository = deps.userRepositoryFactory.forTenant(organizationId);
    const user = await repository.findById(createUserId(payload.userId));
    if (!user) {
      throw mfaChallengeInvalid();
    }

    const plaintextSecret = user.mfa.secret === null ? null : deps.secretCipher.decrypt(user.mfa.secret);
    if (!user.mfa.enabled || !plaintextSecret || !deps.totpService.verify(input.totp, plaintextSecret)) {
      throw mfaTokenInvalid();
    }

    return deps.unitOfWork.withTransaction(async (tx) => {
      const consumed = await deps.mfaChallenges.consume(payload.jti, now, tx);
      if (!consumed) {
        throw mfaChallengeInvalid();
      }

      const minted = await deps.issueSessionFor({
        userId: user.id,
        organizationId,
        actorType: 'USER',
        now,
        tx,
      });

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: 'USER',
          actorId: user.id,
          action: 'LOGIN',
          resource: 'sessions',
          resourceId: null,
          detail: { via: 'mfa_challenge' },
          ipAddress: input.ipAddress ?? null,
        },
        tx,
      );

      return minted;
    });
  };
}
