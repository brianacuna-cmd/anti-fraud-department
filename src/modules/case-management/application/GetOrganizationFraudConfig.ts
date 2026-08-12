import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { OrganizationFraudConfigRepository } from '../domain/ports/OrganizationFraudConfigRepository.js';
import type { OrganizationFraudConfig } from '../domain/model/aggregates/OrganizationFraudConfig.js';
import { organizationFraudConfigNotFound } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface GetOrganizationFraudConfigInput {
  readonly auth: AuthContext;
}

export interface GetOrganizationFraudConfigDeps {
  readonly repository: OrganizationFraudConfigRepository;
}

export function createGetOrganizationFraudConfigUseCase(deps: GetOrganizationFraudConfigDeps) {
  return async function getOrganizationFraudConfig(
    input: GetOrganizationFraudConfigInput,
  ): Promise<OrganizationFraudConfig> {
    const organizationId = requireTenantContext(input.auth);

    const config = await deps.repository.findByOrganization(organizationId);
    if (!config) {
      throw organizationFraudConfigNotFound(organizationId);
    }
    return config;
  };
}
