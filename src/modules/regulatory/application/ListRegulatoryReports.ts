import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { RegulatoryReportStatus } from '../domain/model/value-objects/RegulatoryReportStatus.js';
import type {
  RegulatoryReportListResult,
  RegulatoryReportRepository,
} from '../domain/ports/RegulatoryReportRepository.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

/**
 * Sin comprobacion de rol mas alla del inquilino: leer que reportes se han
 * presentado es exactamente lo que el plano de gobierno (ADMIN, AUDITOR,
 * ORGANIZATION) existe para hacer.
 */
export function createListRegulatoryReportsUseCase(deps: {
  readonly reports: RegulatoryReportRepository;
}) {
  return async function listRegulatoryReports(input: {
    readonly auth: AuthContext;
    readonly status?: readonly RegulatoryReportStatus[];
    readonly limit: number;
    readonly offset: number;
  }): Promise<RegulatoryReportListResult> {
    const organizationId = requireTenantContext(input.auth);
    return deps.reports.list({
      organizationId,
      status: input.status,
      limit: input.limit,
      offset: input.offset,
    });
  };
}
