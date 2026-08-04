import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { OrganizationListPage, OrganizationRepository } from '../domain/ports/OrganizationRepository.js';
import { requirePlatformAdmin } from './authorization/requirePlatformAdmin.js';

export interface ListOrganizationsInput {
  readonly auth: AuthContext;
  readonly limit: number;
  readonly cursor?: string;
}

export interface ListOrganizationsDeps {
  readonly organizations: OrganizationRepository;
}

export function createListOrganizationsUseCase(deps: ListOrganizationsDeps) {
  return async function listOrganizations(input: ListOrganizationsInput): Promise<OrganizationListPage> {
    requirePlatformAdmin(input.auth);

    return deps.organizations.list(input.limit, input.cursor);
  };
}
