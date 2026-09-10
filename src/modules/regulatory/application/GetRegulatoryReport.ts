import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { RegulatoryReport } from '../domain/model/aggregates/RegulatoryReport.js';
import type { RegulatoryReportId } from '../domain/model/value-objects/RegulatoryReportId.js';
import type { RegulatoryReportRepository } from '../domain/ports/RegulatoryReportRepository.js';
import { regulatoryReportNotFound } from '../domain/errors/RegulatoryError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export function createGetRegulatoryReportUseCase(deps: {
  readonly reports: RegulatoryReportRepository;
}) {
  return async function getRegulatoryReport(input: {
    readonly auth: AuthContext;
    readonly reportId: RegulatoryReportId;
  }): Promise<RegulatoryReport> {
    const organizationId = requireTenantContext(input.auth);
    const report = await deps.reports.findById(input.reportId);
    // Mismo 404 para "no existe" y "es de otro inquilino": distinguirlos
    // confirmaria la existencia de una fila ajena.
    if (report === null || report.organizationId !== organizationId) {
      throw regulatoryReportNotFound(input.reportId);
    }
    return report;
  };
}
