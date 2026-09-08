import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import { OrganizationSarFilingProfile } from '../domain/model/aggregates/OrganizationSarFilingProfile.js';
import type { OrganizationSarFilingProfileId } from '../domain/model/value-objects/OrganizationSarFilingProfileId.js';
import type { PostalAddress } from '../domain/model/value-objects/PostalAddress.js';
import type { TinType } from '../domain/model/value-objects/TinType.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { OrganizationSarFilingProfileRepository } from '../domain/ports/OrganizationSarFilingProfileRepository.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SAR_WRITE_ROLES } from './authorization/policy.js';

export interface UpsertSarFilingProfileInput {
  readonly auth: AuthContext;
  readonly filerName: string;
  readonly filerTin: string;
  readonly filerTinType: TinType;
  readonly filerAddress: PostalAddress;
  readonly contactName: string;
  readonly contactPhone: string;
  readonly contactEmail?: string | null;
}

export interface UpsertSarFilingProfileDeps {
  readonly profiles: OrganizationSarFilingProfileRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateOrganizationSarFilingProfileId: () => OrganizationSarFilingProfileId;
}

/**
 * Sets who this organization is when it files (SAR-003 prerequisite).
 *
 * One profile per tenant, replaced whole rather than patched field by field:
 * a filing identity that is half old and half new is worse than either, and
 * the form that edits it shows every field anyway.
 *
 * SUPERVISOR only, same door as drafting a report — the legal name and TIN
 * on a regulatory filing are not a settings preference.
 */
export function createUpsertSarFilingProfileUseCase(deps: UpsertSarFilingProfileDeps) {
  return async function upsertSarFilingProfile(
    input: UpsertSarFilingProfileInput,
  ): Promise<OrganizationSarFilingProfile> {
    requireOperationalRole(input.auth, SAR_WRITE_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const now = deps.clock.now();

    return deps.unitOfWork.withTransaction(async (tx) => {
      const existing = await deps.profiles.findByOrganization(organizationId, tx);
      const profile =
        existing === null
          ? OrganizationSarFilingProfile.create({
              id: deps.generateOrganizationSarFilingProfileId(),
              organizationId,
              filerName: input.filerName,
              filerTin: input.filerTin,
              filerTinType: input.filerTinType,
              filerAddress: input.filerAddress,
              contactName: input.contactName,
              contactPhone: input.contactPhone,
              contactEmail: input.contactEmail ?? null,
              now,
            })
          : existing.update({
              filerName: input.filerName,
              filerTin: input.filerTin,
              filerTinType: input.filerTinType,
              filerAddress: input.filerAddress,
              contactName: input.contactName,
              contactPhone: input.contactPhone,
              contactEmail: input.contactEmail ?? null,
              now,
            });

      await deps.profiles.save(profile, tx);

      /*
       * The TIN is NOT in the audit detail. It identifies the institution to
       * the taxman, the audit log is read far more widely than the filing
       * form, and knowing the profile changed is what the trail is for.
       */
      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'UPSERT_SAR_FILING_PROFILE',
          resource: 'sar_filing_profile',
          resourceId: profile.id,
          detail: { filerName: profile.filerName, created: existing === null },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return profile;
    });
  };
}
