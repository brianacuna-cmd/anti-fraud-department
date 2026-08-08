import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../../shared/time/Clock.js';
import type { AdminOrganizationRepository } from '../../domain/ports/AdminOrganizationRepository.js';
import type { AdminKeyPairGenerator } from '../../domain/ports/AdminKeyPairGenerator.js';
import type { SecretCipher } from '../../domain/ports/SecretCipher.js';
import type { UnitOfWork } from '../../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../../domain/ports/AuditRecorder.js';
import type { AdminOrganizationId } from '../../domain/model/value-objects/AdminOrganizationId.js';
import type { AdminKeyId } from '../../domain/model/value-objects/AdminKeyId.js';
import { AdminOrganization } from '../../domain/model/aggregates/AdminOrganization.js';
import { createAdminKey } from '../../domain/model/value-objects/AdminKey.js';
import { createEmail } from '../../domain/model/value-objects/Email.js';
import { requirePlatformAdmin } from '../authorization/requirePlatformAdmin.js';

export interface ProvisionAdminOrganizationInput {
  readonly auth: AuthContext;
  readonly email: string;
}

export interface ProvisionAdminOrganizationDeps {
  readonly admins: AdminOrganizationRepository;
  readonly keyPairs: AdminKeyPairGenerator;
  readonly cipher: SecretCipher;
  /** NEW (audit-logs-foundation Phase 4): wraps the write in a transaction so the PLATFORM_ADMIN_PROVISIONED audit row commits atomically with it. */
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateAdminOrganizationId: () => AdminOrganizationId;
  readonly generateAdminKeyId: () => AdminKeyId;
  /** NEW (audit-logs-foundation Phase 4): emits PLATFORM_ADMIN_PROVISIONED. */
  readonly auditRecorder: AuditRecorder;
}

/**
 * Provisions a new `AdminOrganization` with a fresh Ed25519 key (design D31,
 * D32). Platform-admin only (design D43's own note: this route legitimately
 * cannot provision the FIRST admin — that is the out-of-band bootstrap
 * script's job, PR 2b). Generates a keypair, stores `publicKey` cleartext
 * and the private key ONLY as `SecretCipher` ciphertext — plaintext never
 * persisted, never returned to the caller.
 */
export function createProvisionAdminOrganizationUseCase(deps: ProvisionAdminOrganizationDeps) {
  return async function provisionAdminOrganization(
    input: ProvisionAdminOrganizationInput,
  ): Promise<AdminOrganization> {
    requirePlatformAdmin(input.auth);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const now = deps.clock.now();
      const { publicKeySpkiPem, privateKeyPkcs8Pem } = deps.keyPairs.generate();
      const encryptedPrivateKey = deps.cipher.encrypt(privateKeyPkcs8Pem);

      const key = createAdminKey({
        keyId: deps.generateAdminKeyId(),
        publicKey: publicKeySpkiPem,
        status: 'ACTIVE',
        encryptedPrivateKey,
        createdAt: now,
      });

      const admin = AdminOrganization.create({
        id: deps.generateAdminOrganizationId(),
        email: createEmail(input.email),
        keys: [key],
        now,
      });

      await deps.admins.save(admin, tx);

      await deps.auditRecorder.record(
        {
          // Platform-level action, not tied to any tenant (design D-A6).
          organizationId: null,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'PLATFORM_ADMIN_PROVISIONED',
          resource: 'adminOrganizations',
          resourceId: admin.id,
          detail: { email: admin.email },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return admin;
    });
  };
}
