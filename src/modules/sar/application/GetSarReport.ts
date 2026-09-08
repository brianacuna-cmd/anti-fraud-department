import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { SarReport } from '../domain/model/aggregates/SarReport.js';
import type { SarReportRepository } from '../domain/ports/SarReportRepository.js';
import { createSarReportId } from '../domain/model/value-objects/SarReportId.js';
import { forbiddenCrossTenant, sarReportNotFound } from '../domain/errors/SarError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface GetSarReportInput {
  readonly auth: AuthContext;
  readonly sarReportId: string;
}

export interface GetSarReportDeps {
  readonly reports: SarReportRepository;
}

/**
 * Reads a single SAR report. Tenant-scoped: a missing one is a 404, one
 * from another org is a 403 (mirrors `ApproveSarReportDraft.ts`'s own
 * cross-tenant convention). No role check — reading a report is not an
 * act of authority, unlike drafting/approving/filing it.
 */
export function createGetSarReportUseCase(deps: GetSarReportDeps) {
  return async function getSarReport(input: GetSarReportInput): Promise<SarReport> {
    const organizationId = requireTenantContext(input.auth);
    const sarReportId = createSarReportId(input.sarReportId);

    const report = await deps.reports.findById(sarReportId);
    if (report === null) {
      throw sarReportNotFound(sarReportId);
    }
    if (report.organizationId !== organizationId) {
      throw forbiddenCrossTenant('SAR report does not belong to the actor organization');
    }
    return report;
  };
}
