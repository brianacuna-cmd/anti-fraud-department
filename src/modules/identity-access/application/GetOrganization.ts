import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { OrganizationRepository } from '../domain/ports/OrganizationRepository.js';
import type { Organization } from '../domain/model/aggregates/Organization.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { organizationNotFound } from '../domain/errors/IdentityAccessError.js';
import { requirePlatformAdmin } from './authorization/requirePlatformAdmin.js';

export interface GetOrganizationInput {
  readonly auth: AuthContext;
  readonly organizationId: string;
}

export interface GetOrganizationDeps {
  readonly organizations: OrganizationRepository;
}

export function createGetOrganizationUseCase(deps: GetOrganizationDeps) {
  return async function getOrganization(input: GetOrganizationInput): Promise<Organization> {
    requirePlatformAdmin(input.auth);

    const organization = await deps.organizations.findById(createOrganizationId(input.organizationId));
    if (!organization) {
      throw organizationNotFound(input.organizationId);
    }
    return organization;
  };
}
