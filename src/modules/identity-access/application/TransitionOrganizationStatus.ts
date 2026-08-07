import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { OrganizationRepository } from '../domain/ports/OrganizationRepository.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { Organization } from '../domain/model/aggregates/Organization.js';
import type { OrganizationStatus } from '../domain/model/value-objects/OrganizationStatus.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { createTransitionActor } from '../domain/model/value-objects/TransitionActor.js';
import { organizationNotFound } from '../domain/errors/IdentityAccessError.js';
import { requirePlatformAdmin } from './authorization/requirePlatformAdmin.js';

export interface TransitionOrganizationStatusInput {
  readonly auth: AuthContext;
  readonly organizationId: string;
  /**
   * Internal field name stays `next` (design D21: "keeping
   * TransitionOrganizationStatus's internal name confines the diff to
   * router + DTO + tests") even though the HTTP body field is `status`
   * (`PATCH /organizations/:id/status`, `organizationRouter.ts` maps it).
   */
  readonly next: OrganizationStatus;
}

export interface TransitionOrganizationStatusDeps {
  readonly organizations: OrganizationRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

/**
 * Backs both `PATCH /organizations/:id/status` (design D21, supersedes
 * `POST /organizations/:id/transition`) and `DELETE /organizations/:id`
 * (organization-lifecycle spec: "Soft Delete as Status Transition").
 * Wrapped in `UnitOfWork.withTransaction` (design D6) even though a
 * single-aggregate write is already atomic in Mongo — establishes the
 * transactional read-modify-write shape ahead of Phase 3's genuine
 * multi-document bootstrap.
 */
export function createTransitionOrganizationStatusUseCase(deps: TransitionOrganizationStatusDeps) {
  return async function transitionOrganizationStatus(
    input: TransitionOrganizationStatusInput,
  ): Promise<Organization> {
    requirePlatformAdmin(input.auth);

    return deps.unitOfWork.withTransaction(async () => {
      const id = createOrganizationId(input.organizationId);
      const organization = await deps.organizations.findById(id);
      if (!organization) {
        throw organizationNotFound(input.organizationId);
      }

      const actor = createTransitionActor(input.auth.isPlatformAdmin);
      const transitioned = organization.transitionTo(input.next, actor, deps.clock.now());
      await deps.organizations.save(transitioned);
      return transitioned;
    });
  };
}
