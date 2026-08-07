import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { OrganizationRepository } from '../domain/ports/OrganizationRepository.js';
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
  readonly clock: Clock;
}

/** Organization Identity Patch — only name/domain; slug stays immutable, `configuration` is not patchable this slice (design A11). */
export function createPatchOrganizationIdentityUseCase(deps: PatchOrganizationIdentityDeps) {
  return async function patchOrganizationIdentity(
    input: PatchOrganizationIdentityInput,
  ): Promise<Organization> {
    requirePlatformAdmin(input.auth);

    const id = createOrganizationId(input.organizationId);
    const organization = await deps.organizations.findById(id);
    if (!organization) {
      throw organizationNotFound(input.organizationId);
    }

    const updated = organization.patchIdentity({ name: input.name, domain: input.domain }, deps.clock.now());
    await deps.organizations.save(updated);
    return updated;
  };
}
