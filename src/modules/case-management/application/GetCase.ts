import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Case } from '../domain/model/aggregates/Case.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { caseNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface GetCaseInput {
  readonly auth: AuthContext;
  readonly caseId: string;
}

export interface GetCaseDeps {
  readonly cases: CaseRepository;
}

/**
 * Reads a single case (the case file). Tenant-scoped: a soft-deleted or missing
 * case is a 404 (`caseNotFound`); a case from another organization is a 403
 * (`forbiddenCrossTenant`) — never leaked as "not found".
 */
export function createGetCaseUseCase(deps: GetCaseDeps) {
  return async function getCase(input: GetCaseInput): Promise<Case> {
    const organizationId = requireTenantContext(input.auth);
    const caseId = createCaseId(input.caseId);

    const kase = await deps.cases.findById(caseId);
    if (kase === null || kase.deletedAt !== null) {
      throw caseNotFound(caseId);
    }
    if (kase.organizationId !== organizationId) {
      throw forbiddenCrossTenant('case does not belong to the actor organization');
    }
    return kase;
  };
}
