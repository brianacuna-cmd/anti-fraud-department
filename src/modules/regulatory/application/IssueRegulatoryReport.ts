import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { RegulatoryReport } from '../domain/model/aggregates/RegulatoryReport.js';
import type { RegulatoryReportId } from '../domain/model/value-objects/RegulatoryReportId.js';
import type { RegulatoryReportRepository } from '../domain/ports/RegulatoryReportRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { regulatoryReportNotFound } from '../domain/errors/RegulatoryError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, REGULATORY_WRITE_ROLES } from './authorization/policy.js';

export interface IssueRegulatoryReportDeps {
  readonly reports: RegulatoryReportRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

/**
 * Cierra el borrador: a partir de aquí las cifras no se tocan.
 *
 * Es un paso propio y no una bandera del compilado porque separa dos actos
 * distintos: calcular es reversible y se hace varias veces; emitir es la firma,
 * y ocurre una sola vez.
 */
export function createIssueRegulatoryReportUseCase(deps: IssueRegulatoryReportDeps) {
  return async function issueRegulatoryReport(input: {
    readonly auth: AuthContext;
    readonly reportId: RegulatoryReportId;
  }): Promise<RegulatoryReport> {
    requireOperationalRole(input.auth, REGULATORY_WRITE_ROLES);
    const organizationId = requireTenantContext(input.auth);

    const existing = await deps.reports.findById(input.reportId);
    if (existing === null || existing.organizationId !== organizationId) {
      throw regulatoryReportNotFound(input.reportId);
    }

    const now = deps.clock.now();
    const issued = existing.issue(input.auth.userId ?? 'SUPERVISOR', now);

    return deps.unitOfWork.withTransaction(async (tx) => {
      await deps.reports.save(issued, tx);
      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'ISSUE_REGULATORY_REPORT',
          resource: 'regulatory_report',
          resourceId: issued.id,
          detail: {
            periodStart: issued.periodStart,
            periodEnd: issued.periodEnd,
            figures: { ...issued.figures },
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );
      return issued;
    });
  };
}
