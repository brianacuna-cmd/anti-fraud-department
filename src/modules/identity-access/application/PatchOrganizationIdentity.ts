import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { OrganizationRepository } from '../domain/ports/OrganizationRepository.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { Organization } from '../domain/model/aggregates/Organization.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { organizationNotFound } from '../domain/errors/IdentityAccessError.js';
import { requirePlatformAdmin } from './authorization/requirePlatformAdmin.js';

export interface PatchOrganizationIdentityInput {
  readonly auth: AuthContext;
  readonly organizationId: string;
  readonly name?: string;
  readonly domain?: string | null;
}

export interface PatchOrganizationIdentityDeps {
  readonly organizations: OrganizationRepository;
  /** NEW (audit-logs-foundation Phase 4): wraps the write in a transaction so the ORGANIZATION_IDENTITY_UPDATED audit row commits atomically with it. */
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  /** NEW (audit-logs-foundation Phase 4): emits ORGANIZATION_IDENTITY_UPDATED. */
  readonly auditRecorder: AuditRecorder;
}

/**
 * Organization Identity Patch — only name/domain; slug stays immutable,
 * `configuration` is not patchable this slice (design A11).
 *
 * audit-logs-foundation Phase 4: NOW wrapped in `UnitOfWork.withTransaction`
 * (previously a single-write use case with no transaction at all) so the
 * write and the `ORGANIZATION_IDENTITY_UPDATED` audit row commit or roll
 * back together (spec "Atomic Emission").
 */
export function createPatchOrganizationIdentityUseCase(deps: PatchOrganizationIdentityDeps) {
  return async function patchOrganizationIdentity(
    input: PatchOrganizationIdentityInput,
  ): Promise<Organization> {
    requirePlatformAdmin(input.auth);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const id = createOrganizationId(input.organizationId);
      const organization = await deps.organizations.findById(id);
      if (!organization) {
        throw organizationNotFound(input.organizationId);
      }

      const updated = organization.patchIdentity({ name: input.name, domain: input.domain }, deps.clock.now());
      await deps.organizations.save(updated, tx);

      await deps.auditRecorder.record(
        {
          organizationId: id,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'ORGANIZATION_IDENTITY_UPDATED',
          resource: 'organizations',
          resourceId: id,
          detail: { name: updated.name, domain: updated.domain },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return updated;
    });
  };
}
