import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Instant } from '../../../shared/time/Instant.js';
import { RegulatoryReport } from '../domain/model/aggregates/RegulatoryReport.js';
import type { RegulatoryReportId } from '../domain/model/value-objects/RegulatoryReportId.js';
import type { RegulatoryReportRepository } from '../domain/ports/RegulatoryReportRepository.js';
import type { RegulatoryFigureSource } from '../domain/ports/RegulatoryFigureSource.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { regulatoryReportNotFound } from '../domain/errors/RegulatoryError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, REGULATORY_WRITE_ROLES } from './authorization/policy.js';

export interface CompileRegulatoryReportInput {
  readonly auth: AuthContext;
  readonly periodStart: Instant;
  readonly periodEnd: Instant;
  /**
   * Cuando viene, se recalcula ESE borrador en vez de crear otro.
   *
   * Sin esto, recompilar un periodo dejaría dos reportes del mismo mes con
   * cifras distintas y sin forma de saber cuál se presentó.
   */
  readonly reportId?: RegulatoryReportId;
}

export interface CompileRegulatoryReportDeps {
  readonly reports: RegulatoryReportRepository;
  readonly figures: RegulatoryFigureSource;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateRegulatoryReportId: () => RegulatoryReportId;
}

/**
 * REG-001: calcula las cifras obligatorias de un periodo y las congela.
 *
 * El cálculo ocurre ANTES de abrir la transacción, a propósito: es una lectura
 * agregada sobre varias colecciones que puede tardar, y mantener abierta una
 * sesión de Mongo mientras se recorre medio inquilino es cómo se agota el pool
 * de conexiones en producción. Lo que va dentro de la transacción es guardar el
 * resultado y su auditoría, que sí tienen que caer juntos.
 */
export function createCompileRegulatoryReportUseCase(deps: CompileRegulatoryReportDeps) {
  return async function compileRegulatoryReport(
    input: CompileRegulatoryReportInput,
  ): Promise<RegulatoryReport> {
    requireOperationalRole(input.auth, REGULATORY_WRITE_ROLES);
    const organizationId = requireTenantContext(input.auth);

    const existing =
      input.reportId === undefined ? null : await deps.reports.findById(input.reportId);
    if (input.reportId !== undefined && (existing === null || existing.organizationId !== organizationId)) {
      throw regulatoryReportNotFound(input.reportId);
    }

    const now = deps.clock.now();
    const computed = await deps.figures.compute({
      organizationId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    });

    /*
     * Recompilar valida el periodo del reporte que ya existe, no el de la
     * petición: un borrador de septiembre se recalcula sobre septiembre, y
     * dejar que la llamada cambiara las fechas convertiría "actualizar" en
     * "reescribir de qué va este documento".
     */
    const report =
      existing !== null
        ? existing.recompile(computed, now)
        : RegulatoryReport.create({
            id: deps.generateRegulatoryReportId(),
            organizationId,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            figures: computed,
            generatedBy: input.auth.userId ?? 'SUPERVISOR',
            now,
          });

    return deps.unitOfWork.withTransaction(async (tx) => {
      await deps.reports.save(report, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'COMPILE_REGULATORY_REPORT',
          resource: 'regulatory_report',
          resourceId: report.id,
          detail: {
            periodStart: report.periodStart,
            periodEnd: report.periodEnd,
            recompiled: existing !== null,
            // Las cifras van a la traza además de a la fila: si alguien
            // recompila, la auditoría conserva lo que decía la versión
            // anterior, que es la única forma de explicar por qué cambió.
            figures: { ...report.figures },
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return report;
    });
  };
}
