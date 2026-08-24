import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { OrganizationScreeningConfigRepository } from '../domain/ports/OrganizationScreeningConfigRepository.js';
import type { ConfianzaThresholds } from '../domain/services/ConfianzaTiering.js';
import { DEFAULT_CONFIANZA_THRESHOLDS } from '../domain/services/ConfianzaTiering.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface GetOrganizationScreeningConfigInput {
  readonly auth: AuthContext;
}

export interface GetOrganizationScreeningConfigDeps {
  readonly repository: OrganizationScreeningConfigRepository;
}

/**
 * RF-6: unlike `GetOrganizationFraudConfig`, a MISSING row is not an error
 * — falls back to `DEFAULT_CONFIANZA_THRESHOLDS` (50/70) so orgs without a
 * configured row keep screening's current default behavior.
 */
export function createGetOrganizationScreeningConfigUseCase(deps: GetOrganizationScreeningConfigDeps) {
  return async function getOrganizationScreeningConfig(
    input: GetOrganizationScreeningConfigInput,
  ): Promise<ConfianzaThresholds> {
    const organizationId = requireTenantContext(input.auth);

    const config = await deps.repository.findByOrganization(organizationId);
    if (!config) {
      return DEFAULT_CONFIANZA_THRESHOLDS;
    }
    return { alertThreshold: config.alertThreshold, signalThreshold: config.signalThreshold };
  };
}
