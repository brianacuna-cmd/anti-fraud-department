import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { AmlAlert } from '../domain/model/aggregates/AmlAlert.js';
import type { AmlAlertRepository } from '../domain/ports/AmlAlertRepository.js';
import { createAmlAlertId } from '../domain/model/value-objects/AmlAlertId.js';
import { amlAlertNotFound, forbiddenCrossTenant } from '../domain/errors/ScreeningError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface GetAmlAlertInput {
  readonly auth: AuthContext;
  readonly alertId: string;
}

export interface GetAmlAlertDeps {
  readonly amlAlertRepository: AmlAlertRepository;
}

/**
 * Reads one AML alert. Missing → 404; other tenant → 403 (never leaked as
 * not-found), mirroring `GetCase`.
 */
export function createGetAmlAlertUseCase(deps: GetAmlAlertDeps) {
  return async function getAmlAlert(input: GetAmlAlertInput): Promise<AmlAlert> {
    const organizationId = requireTenantContext(input.auth);
    const alertId = createAmlAlertId(input.alertId);
    const alert = await deps.amlAlertRepository.findById(alertId);
    if (alert === null) {
      throw amlAlertNotFound(alertId);
    }
    if (alert.organizationId !== organizationId) {
      throw forbiddenCrossTenant('aml alert does not belong to the actor organization');
    }
    return alert;
  };
}
