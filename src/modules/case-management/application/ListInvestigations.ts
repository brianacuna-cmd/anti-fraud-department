import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Investigation } from '../domain/model/aggregates/Investigation.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { InvestigationRepository } from '../domain/ports/InvestigationRepository.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { caseNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface ListInvestigationsInput {
  readonly auth: AuthContext;
  readonly caseId: string;
}

export interface ListInvestigationsDeps {
  readonly cases: CaseRepository;
  readonly investigations: InvestigationRepository;
}

/** Lists a case's investigations oldest-first, behind the same tenant + soft-delete gates as `GetCase`. */
export function createListInvestigationsUseCase(deps: ListInvestigationsDeps) {
  return async function listInvestigations(input: ListInvestigationsInput): Promise<Investigation[]> {
    const organizationId = requireTenantContext(input.auth);
    const caseId = createCaseId(input.caseId);

    const kase = await deps.cases.findById(caseId);
    if (kase === null || kase.deletedAt !== null) {
      throw caseNotFound(caseId);
    }
    if (kase.organizationId !== organizationId) {
      throw forbiddenCrossTenant('case does not belong to the actor organization');
    }
    return deps.investigations.listByCaseId(caseId);
  };
}
