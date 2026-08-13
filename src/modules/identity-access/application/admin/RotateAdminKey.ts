import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../../shared/time/Clock.js';
import type { AdminOrganizationRepository } from '../../domain/ports/AdminOrganizationRepository.js';
import type { SessionRepository } from '../../domain/ports/SessionRepository.js';
import type { AdminKeyPairGenerator } from '../../domain/ports/AdminKeyPairGenerator.js';
import type { SecretCipher } from '../../domain/ports/SecretCipher.js';
import type { UnitOfWork } from '../../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../../domain/ports/AuditRecorder.js';
import type { AdminOrganization } from '../../domain/model/aggregates/AdminOrganization.js';
import type { AdminKeyId } from '../../domain/model/value-objects/AdminKeyId.js';
import { createAdminOrganizationId } from '../../domain/model/value-objects/AdminOrganizationId.js';
import { createAdminKey } from '../../domain/model/value-objects/AdminKey.js';
import { adminOrganizationNotFound } from '../../domain/errors/IdentityAccessError.js';
import { requirePlatformAdmin } from '../authorization/requirePlatformAdmin.js';

export interface RotateAdminKeyInput {
  readonly auth: AuthContext;
  readonly adminOrganizationId: string;
}

export interface RotateAdminKeyDeps {
  readonly admins: AdminOrganizationRepository;
  readonly sessions: SessionRepository;
  readonly keyPairs: AdminKeyPairGenerator;
  readonly cipher: SecretCipher;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateAdminKeyId: () => AdminKeyId;
  readonly auditRecorder: AuditRecorder;
}

/**
 * Key rotation (design D33, spec "Key Rotation"): generates a fresh Ed25519
 * keypair, encrypts the new private key exactly like `provisionAdminOrganizationCore`,
 * and calls `AdminOrganization.rotateKey` (demotes the current ACTIVE key to
 * DEPRECATED, activates the new one — aggregate invariant: at most one
 * ACTIVE key). D40 session cascade: every existing session for this admin is
 * revoked in the SAME transaction as the key change and the audit row, so a
 * caller cannot observe a rotated-but-still-logged-in-on-the-old-trust-root
 * window.
 */
export function createRotateAdminKeyUseCase(deps: RotateAdminKeyDeps) {
  return async function rotateAdminKey(input: RotateAdminKeyInput): Promise<AdminOrganization> {
    requirePlatformAdmin(input.auth);

    const adminOrganizationId = createAdminOrganizationId(input.adminOrganizationId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const now = deps.clock.now();

      const admin = await deps.admins.findById(adminOrganizationId);
      if (!admin) {
        throw adminOrganizationNotFound(input.adminOrganizationId);
      }

      const { publicKeySpkiPem, privateKeyPkcs8Pem } = deps.keyPairs.generate();
      const encryptedPrivateKey = deps.cipher.encrypt(privateKeyPkcs8Pem);

      const newKey = createAdminKey({
        keyId: deps.generateAdminKeyId(),
        publicKey: publicKeySpkiPem,
        status: 'ACTIVE',
        encryptedPrivateKey,
        createdAt: now,
      });

      const rotated = admin.rotateKey(newKey, now);
      await deps.admins.save(rotated, tx);

      await deps.sessions.revokeAllForActor(
        { actorType: 'PLATFORM_ADMIN', adminOrganizationId: admin.id },
        now,
        tx,
      );

      await deps.auditRecorder.record(
        {
          organizationId: null,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'PLATFORM_ADMIN_KEY_ROTATED',
          resource: 'adminOrganizations',
          resourceId: admin.id,
          detail: { newKeyId: newKey.keyId },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return rotated;
    });
  };
}
