import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../../shared/time/Clock.js';
import type { AdminOrganizationRepository } from '../../domain/ports/AdminOrganizationRepository.js';
import type { SecretCipher } from '../../domain/ports/SecretCipher.js';
import type { UnitOfWork } from '../../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../../domain/ports/AuditRecorder.js';
import { createAdminOrganizationId } from '../../domain/model/value-objects/AdminOrganizationId.js';
import { createAdminKeyId } from '../../domain/model/value-objects/AdminKeyId.js';
import { adminOrganizationNotFound, adminPrivateKeyUnavailable, invariantViolation } from '../../domain/errors/IdentityAccessError.js';
import { requirePlatformAdmin } from '../authorization/requirePlatformAdmin.js';

export interface DownloadAdminPrivateKeyInput {
  readonly auth: AuthContext;
  readonly adminOrganizationId: string;
  readonly keyId: string;
}

export interface DownloadAdminPrivateKeyResult {
  /** Plaintext PKCS8 PEM — returned to the caller EXACTLY ONCE, never persisted or logged. */
  readonly privateKeyPkcs8Pem: string;
}

export interface DownloadAdminPrivateKeyDeps {
  readonly admins: AdminOrganizationRepository;
  readonly cipher: SecretCipher;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly auditRecorder: AuditRecorder;
}

/**
 * One-time private-key download (design D32a, spec "One-Time Private Key
 * Download"). Delete-after-download: `AdminOrganizationRepository.claimPrivateKey`
 * is the atomic, single-winner CAS (design "PR-2 key lifecycle") — it nulls
 * out `encryptedPrivateKey` in the SAME `findOneAndUpdate` that reads it, so
 * there is never a decryptable copy left at rest after a successful claim.
 * A second download of the same key always loses the CAS and rejects with
 * `ADMIN_PRIVATE_KEY_UNAVAILABLE`.
 *
 * The plaintext PEM is decrypted exactly once, held only in this call's
 * stack, and NEVER passed to `auditRecorder`/logs — the audit `detail`
 * carries no key material, only the `keyId`.
 */
export function createDownloadAdminPrivateKeyUseCase(deps: DownloadAdminPrivateKeyDeps) {
  return async function downloadAdminPrivateKey(
    input: DownloadAdminPrivateKeyInput,
  ): Promise<DownloadAdminPrivateKeyResult> {
    requirePlatformAdmin(input.auth);

    const adminOrganizationId = createAdminOrganizationId(input.adminOrganizationId);
    const keyId = createAdminKeyId(input.keyId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const now = deps.clock.now();

      const admin = await deps.admins.findById(adminOrganizationId);
      if (!admin) {
        throw adminOrganizationNotFound(input.adminOrganizationId);
      }

      const claimedCiphertext = await deps.admins.claimPrivateKey(adminOrganizationId, keyId, now, tx);
      if (claimedCiphertext === null) {
        throw adminPrivateKeyUnavailable();
      }

      const privateKeyPkcs8Pem = deps.cipher.decrypt(claimedCiphertext);
      if (privateKeyPkcs8Pem === null) {
        throw invariantViolation('claimed admin private key ciphertext failed to decrypt', {
          adminOrganizationId: input.adminOrganizationId,
          keyId: input.keyId,
        });
      }

      await deps.auditRecorder.record(
        {
          organizationId: null,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'PLATFORM_ADMIN_PRIVATE_KEY_DOWNLOADED',
          resource: 'adminOrganizations',
          resourceId: admin.id,
          detail: { keyId: input.keyId },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return { privateKeyPkcs8Pem };
    });
  };
}
