import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Investigation } from '../domain/model/aggregates/Investigation.js';
import type { InvestigationRepository } from '../domain/ports/InvestigationRepository.js';
import { createInvestigationId } from '../domain/model/value-objects/InvestigationId.js';
import { investigationNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface GetInvestigationInput {
  readonly auth: AuthContext;
  readonly investigationId: string;
}

export interface GetInvestigationDeps {
  readonly investigations: InvestigationRepository;
}

/**
 * Reads a single investigation. Tenant-scoped: a missing one is a 404
 * (`investigationNotFound`); one from another org is a 403
 * (`forbiddenCrossTenant`), never leaked as "not found".
 */
export function createGetInvestigationUseCase(deps: GetInvestigationDeps) {
  return async function getInvestigation(input: GetInvestigationInput): Promise<Investigation> {
    const organizationId = requireTenantContext(input.auth);
    const investigationId = createInvestigationId(input.investigationId);

    const investigation = await deps.investigations.findById(investigationId);
    if (investigation === null) {
      throw investigationNotFound(investigationId);
    }
    if (investigation.organizationId !== organizationId) {
      throw forbiddenCrossTenant('investigation does not belong to the actor organization');
    }
    return investigation;
  };
}
