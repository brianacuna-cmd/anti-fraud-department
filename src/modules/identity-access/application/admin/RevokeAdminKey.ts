import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../../shared/time/Clock.js';
import type { AdminOrganizationRepository } from '../../domain/ports/AdminOrganizationRepository.js';
import type { SessionRepository } from '../../domain/ports/SessionRepository.js';
import type { UnitOfWork } from '../../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../../domain/ports/AuditRecorder.js';
import type { AdminOrganization } from '../../domain/model/aggregates/AdminOrganization.js';
import { createAdminOrganizationId } from '../../domain/model/value-objects/AdminOrganizationId.js';
import { createAdminKeyId } from '../../domain/model/value-objects/AdminKeyId.js';
import { adminOrganizationNotFound } from '../../domain/errors/IdentityAccessError.js';
import { requirePlatformAdmin } from '../authorization/requirePlatformAdmin.js';

export interface RevokeAdminKeyInput {
  readonly auth: AuthContext;
  readonly adminOrganizationId: string;
  readonly keyId: string;
}

export interface RevokeAdminKeyDeps {
  readonly admins: AdminOrganizationRepository;
  readonly sessions: SessionRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly auditRecorder: AuditRecorder;
}

/**
 * Key revocation (design D33, spec "Key Revocation"): terminal, non-reversible
 * — `AdminOrganization.revokeKey` throws `INVARIANT_VIOLATION` for an unknown
 * `keyId` or a key that is already `REVOKED` (double-revoke rejected). D40
 * session cascade: every existing session for this admin is revoked in the
 * SAME transaction as the key change and the audit row (mirrors
 * `RotateAdminKey` — a revoked key must never leave a live session that
 * outlives the trust it was minted under).
 */
export function createRevokeAdminKeyUseCase(deps: RevokeAdminKeyDeps) {
  return async function revokeAdminKey(input: RevokeAdminKeyInput): Promise<AdminOrganization> {
    requirePlatformAdmin(input.auth);

    const adminOrganizationId = createAdminOrganizationId(input.adminOrganizationId);
    const keyId = createAdminKeyId(input.keyId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const now = deps.clock.now();

      const admin = await deps.admins.findById(adminOrganizationId);
      if (!admin) {
        throw adminOrganizationNotFound(input.adminOrganizationId);
      }

      const revoked = admin.revokeKey(keyId, now);
      await deps.admins.save(revoked, tx);

      await deps.sessions.revokeAllForActor({ actorType: 'PLATFORM_ADMIN', userId: admin.id }, now, tx);

      await deps.auditRecorder.record(
        {
          organizationId: null,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'PLATFORM_ADMIN_KEY_REVOKED',
          resource: 'adminOrganizations',
          resourceId: admin.id,
          detail: { keyId: input.keyId },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return revoked;
    });
  };
}
