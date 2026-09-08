import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { OrganizationSarFilingProfile } from '../domain/model/aggregates/OrganizationSarFilingProfile.js';
import type { OrganizationSarFilingProfileRepository } from '../domain/ports/OrganizationSarFilingProfileRepository.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface GetSarFilingProfileInput {
  readonly auth: AuthContext;
}

export interface GetSarFilingProfileDeps {
  readonly profiles: OrganizationSarFilingProfileRepository;
}

/**
 * The tenant's filing identity, or `null` when it was never configured.
 *
 * `null` instead of a 404 on purpose: "not configured yet" is the ordinary
 * state of a new tenant, and the settings screen needs to render an empty
 * form for it, not an error.
 */
export function createGetSarFilingProfileUseCase(deps: GetSarFilingProfileDeps) {
  return async function getSarFilingProfile(
    input: GetSarFilingProfileInput,
  ): Promise<OrganizationSarFilingProfile | null> {
    const organizationId = requireTenantContext(input.auth);
    return deps.profiles.findByOrganization(organizationId);
  };
}
