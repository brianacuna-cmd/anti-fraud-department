import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { CaseReport } from '../domain/model/aggregates/CaseReport.js';
import type { CaseReportRepository } from '../domain/ports/CaseReportRepository.js';
import { createCaseReportId } from '../domain/model/value-objects/CaseReportId.js';
import { caseReportNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface GetCaseReportInput {
  readonly auth: AuthContext;
  readonly reportId: string;
}

export interface GetCaseReportDeps {
  readonly reports: CaseReportRepository;
}

/**
 * Reads a single case report. Tenant-scoped: a missing one is a 404
 * (`caseReportNotFound`); one from another org is a 403 (`forbiddenCrossTenant`),
 * never leaked as "not found".
 */
export function createGetCaseReportUseCase(deps: GetCaseReportDeps) {
  return async function getCaseReport(input: GetCaseReportInput): Promise<CaseReport> {
    const organizationId = requireTenantContext(input.auth);
    const reportId = createCaseReportId(input.reportId);

    const report = await deps.reports.findById(reportId);
    if (report === null) {
      throw caseReportNotFound(reportId);
    }
    if (report.organizationId !== organizationId) {
      throw forbiddenCrossTenant('case report does not belong to the actor organization');
    }
    return report;
  };
}
