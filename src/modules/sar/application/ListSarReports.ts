import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { SarReportListResult, SarReportRepository } from '../domain/ports/SarReportRepository.js';
import type { SarReportStatus } from '../domain/model/value-objects/SarReportStatus.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface ListSarReportsInput {
  readonly auth: AuthContext;
  readonly status?: readonly SarReportStatus[];
  readonly limit: number;
  readonly offset: number;
}

export interface ListSarReportsDeps {
  readonly reports: SarReportRepository;
}

/** Tenant-scoped, paginated, filterable SAR report listing. No role check — same as `GetSarReport`. */
export function createListSarReportsUseCase(deps: ListSarReportsDeps) {
  return async function listSarReports(input: ListSarReportsInput): Promise<SarReportListResult> {
    const organizationId = requireTenantContext(input.auth);
    return deps.reports.list({
      organizationId,
      status: input.status,
      limit: input.limit,
      offset: input.offset,
    });
  };
}
