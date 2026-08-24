import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { AmlAlertListResult, AmlAlertRepository } from '../domain/ports/AmlAlertRepository.js';
import type { AmlAlertStatus } from '../domain/model/value-objects/AmlAlertStatus.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface ListAmlAlertsInput {
  readonly auth: AuthContext;
  readonly estado?: readonly AmlAlertStatus[];
  readonly limit: number;
  readonly offset: number;
}

export interface ListAmlAlertsDeps {
  readonly amlAlertRepository: AmlAlertRepository;
}

/** Tenant-scoped compliance inbox. Newest first. */
export function createListAmlAlertsUseCase(deps: ListAmlAlertsDeps) {
  return async function listAmlAlerts(input: ListAmlAlertsInput): Promise<AmlAlertListResult> {
    const organizationId = requireTenantContext(input.auth);
    return deps.amlAlertRepository.list({
      organizationId,
      estado: input.estado,
      limit: input.limit,
      offset: input.offset,
    });
  };
}
