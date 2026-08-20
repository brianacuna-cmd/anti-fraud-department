import type { Clock } from '../../../../shared/time/Clock.js';
import type { AdminOrganizationRepository } from '../../domain/ports/AdminOrganizationRepository.js';
import type { AdminChallengeStore } from '../../domain/ports/AdminChallengeStore.js';
import type { SignatureVerifier } from '../../domain/ports/SignatureVerifier.js';
import type { UnitOfWork } from '../../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../../domain/ports/AuditRecorder.js';
import { createAdminOrganizationId } from '../../domain/model/value-objects/AdminOrganizationId.js';
import { adminChallengeInvalid } from '../../domain/errors/IdentityAccessError.js';
import type { createSessionIssuer, MintedSession } from '../auth/SessionIssuer.js';

/** Domain-separation prefix (design "Ed25519 SignatureVerifier"): prevents an
 * admin's signature from being replayed as a valid signature in any other
 * protocol. The client MUST sign exactly `PREFIX + challenge`. */
const CANONICAL_MESSAGE_PREFIX = 'AFD-ADMIN-CHALLENGE-V1\n';

export interface VerifyAdminChallengeInput {
  readonly challengeId: string;
  readonly signatureBase64: string;
  readonly ipAddress?: string | null;
}

/**
 * La sesion emitida, mas la identidad del super admin que firmo el reto.
 *
 * `adminOrganizationId`/`email` son aditivos y salen del agregado que este
 * caso de uso ya carga. Sin ellos, el transporte tenia que adivinar a quien
 * pertenecia el reto consultando Mongo por su cuenta —tomando "el primero con
 * una llave ACTIVA"—, de modo que con mas de un super admin el OTP de uno
 * podia acabar en el correo de otro.
 */
export interface VerifyAdminChallengeResult extends MintedSession {
  readonly adminOrganizationId: string;
  readonly email: string;
}

export interface VerifyAdminChallengeDeps {
  readonly admins: AdminOrganizationRepository;
  readonly adminChallenges: AdminChallengeStore;
  readonly signatureVerifier: SignatureVerifier;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly issueSessionFor: ReturnType<typeof createSessionIssuer>;
  readonly auditRecorder: AuditRecorder;
}

/**
 * Step 2 of PLATFORM_ADMIN challenge-login (design "Use cases",
 * `VerifyAdminChallenge`). Public/unauthenticated — this IS the login.
 *
 * Verification happens OUTSIDE the transaction, BEFORE any consume/mint
 * (mirrors `IssueSession`'s "wrong TOTP never consumes the jti" precedent):
 * a forged/invalid signature rejects WITHOUT consuming the challenge, so a
 * network attacker without the private key can never burn a legitimate
 * admin's live challenge (design "Bad signature does NOT consume the
 * challenge").
 *
 * On a valid signature, `withTransaction` runs consume-FIRST-mint-SECOND
 * (design "consume-first-mint-second"): `AdminChallengeStore.consume` is the
 * atomic single-use gate — a loser (replay/expired/already-consumed) throws
 * BEFORE `SessionIssuer` ever mints a second `Sessions` row for the same
 * challenge.
 *
 * Only the admin's current `activeKey()` verifies (design D31a) — a
 * signature produced by a DEPRECATED/REVOKED key never matches because
 * `activeKey()` only ever returns the single ACTIVE key (or `null`).
 */
export function createVerifyAdminChallengeUseCase(deps: VerifyAdminChallengeDeps) {
  return async function verifyAdminChallenge(
    input: VerifyAdminChallengeInput,
  ): Promise<VerifyAdminChallengeResult> {
    const now = deps.clock.now();

    const record = await deps.adminChallenges.findById(input.challengeId);
    if (!record) {
      throw adminChallengeInvalid();
    }

    const adminOrganizationId = createAdminOrganizationId(record.adminOrganizationId);
    const admin = await deps.admins.findById(adminOrganizationId);
    const activeKey = admin?.activeKey() ?? null;
    if (!admin || !activeKey) {
      throw adminChallengeInvalid();
    }

    const message = Buffer.from(CANONICAL_MESSAGE_PREFIX + record.challenge, 'utf8');
    const isValidSignature = deps.signatureVerifier.verify(message, input.signatureBase64, activeKey.publicKey);
    if (!isValidSignature) {
      await deps.auditRecorder.record({
        organizationId: null,
        actorType: 'PLATFORM_ADMIN',
        actorId: admin.id,
        action: 'PLATFORM_ADMIN_LOGIN_FAILED',
        resource: 'sessions',
        resourceId: null,
        detail: { via: 'admin_challenge', reason: 'invalid_signature' },
        ipAddress: input.ipAddress ?? null,
      });
      throw adminChallengeInvalid();
    }

    return deps.unitOfWork.withTransaction(async (tx) => {
      const consumed = await deps.adminChallenges.consume(input.challengeId, now, tx);
      if (!consumed) {
        throw adminChallengeInvalid();
      }

      const minted = await deps.issueSessionFor({
        adminOrganizationId: admin.id,
        ipAddress: input.ipAddress ?? null,
        now,
        tx,
      });

      await deps.auditRecorder.record(
        {
          organizationId: null,
          actorType: 'PLATFORM_ADMIN',
          actorId: admin.id,
          action: 'PLATFORM_ADMIN_LOGIN',
          resource: 'sessions',
          resourceId: null,
          detail: { via: 'admin_challenge' },
          ipAddress: input.ipAddress ?? null,
        },
        tx,
      );

      return { ...minted, adminOrganizationId: admin.id, email: admin.email };
    });
  };
}
