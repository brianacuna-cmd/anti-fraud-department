import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { CaseReport } from '../domain/model/aggregates/CaseReport.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { CaseReportRepository } from '../domain/ports/CaseReportRepository.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { caseNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface ListCaseReportsInput {
  readonly auth: AuthContext;
  readonly caseId: string;
}

export interface ListCaseReportsDeps {
  readonly cases: CaseRepository;
  readonly reports: CaseReportRepository;
}

/** Lists a case's reports newest-first, behind the same tenant + soft-delete gates as `GetCase`. */
export function createListCaseReportsUseCase(deps: ListCaseReportsDeps) {
  return async function listCaseReports(input: ListCaseReportsInput): Promise<CaseReport[]> {
    const organizationId = requireTenantContext(input.auth);
    const caseId = createCaseId(input.caseId);

    const kase = await deps.cases.findById(caseId);
    if (kase === null || kase.deletedAt !== null) {
      throw caseNotFound(caseId);
    }
    if (kase.organizationId !== organizationId) {
      throw forbiddenCrossTenant('case does not belong to the actor organization');
    }
    return deps.reports.listByCaseId(caseId);
  };
}
