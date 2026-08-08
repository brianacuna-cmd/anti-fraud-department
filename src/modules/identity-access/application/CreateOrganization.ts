import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { OrganizationRepository } from '../domain/ports/OrganizationRepository.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { OrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { Organization } from '../domain/model/aggregates/Organization.js';
import { createSlug } from '../domain/model/value-objects/Slug.js';
import { organizationSlugTaken } from '../domain/errors/IdentityAccessError.js';
import { requirePlatformAdmin } from './authorization/requirePlatformAdmin.js';

export interface CreateOrganizationInput {
  readonly auth: AuthContext;
  readonly name: string;
  readonly slug: string;
  readonly domain?: string | null;
}

export interface CreateOrganizationDeps {
  readonly organizations: OrganizationRepository;
  /** NEW (audit-logs-foundation Phase 4): wraps the write in a transaction so the ORGANIZATION_CREATED audit row commits atomically with it. */
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateId: () => OrganizationId;
  /** NEW (audit-logs-foundation Phase 4): emits ORGANIZATION_CREATED. */
  readonly auditRecorder: AuditRecorder;
}

/**
 * Atomic Organization Bootstrap (organization half) — platform-admin only.
 *
 * audit-logs-foundation Phase 4: NOW wrapped in `UnitOfWork.withTransaction`
 * (previously a single-write use case with no transaction at all) so the
 * `Organization` write and the `ORGANIZATION_CREATED` audit row commit or
 * roll back together (spec "Atomic Emission").
 */
export function createCreateOrganizationUseCase(deps: CreateOrganizationDeps) {
  return async function createOrganization(input: CreateOrganizationInput): Promise<Organization> {
    requirePlatformAdmin(input.auth);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const slug = createSlug(input.slug);
      const existing = await deps.organizations.findBySlug(slug, tx);
      if (existing) {
        throw organizationSlugTaken(input.slug);
      }

      const organization = Organization.create({
        id: deps.generateId(),
        name: input.name,
        slug,
        domain: input.domain,
        now: deps.clock.now(),
      });

      await deps.organizations.save(organization, tx);

      await deps.auditRecorder.record(
        {
          organizationId: organization.id,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'ORGANIZATION_CREATED',
          resource: 'organizations',
          resourceId: organization.id,
          detail: { name: organization.name, slug: organization.slug },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return organization;
    });
  };
}
