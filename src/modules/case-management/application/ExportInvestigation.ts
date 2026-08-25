import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CaseReportRepository } from '../domain/ports/CaseReportRepository.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { CaseReportId } from '../domain/model/value-objects/CaseReportId.js';
import type { CaseReport } from '../domain/model/aggregates/CaseReport.js';
import { CaseReport as CaseReportAggregate } from '../domain/model/aggregates/CaseReport.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import type { createExportInvestigationSummaryUseCase } from './ExportInvestigationSummary.js';

export interface ExportInvestigationInput {
  readonly auth: AuthContext;
  readonly investigationId: string;
  readonly maxDepth?: number;
}

export interface ExportInvestigationDeps {
  readonly exportInvestigationSummary: ReturnType<typeof createExportInvestigationSummaryUseCase>;
  readonly reports: CaseReportRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateCaseReportId: () => CaseReportId;
}

/**
 * INV-014 — congela el informe ejecutivo de una investigación.
 *
 * GET /investigations/:investigationId/export
 *
 * Es el mismo informe que devuelve `/summary`, con notas y evidencia de cada
 * expediente, escrito en `case_reports` con `reportType: 'INVESTIGATION_EXPORT'`
 * y colgado del expediente raíz de la investigación.
 *
 * POR QUÉ DOS RUTAS Y NO UNA
 *
 * `/summary` responde "cómo está la red ahora" y por eso no se guarda: una
 * investigación abierta cambia con cada expediente que entra, y una copia
 * congelada de eso solo produce informes que envejecen en silencio.
 *
 * Un export es lo contrario. Se entrega a alguien —un comité, un regulador, un
 * juzgado— y ese alguien tiene que poder abrir meses después exactamente lo que
 * se le entregó. Si el documento se recalcula al abrirlo, emisor y receptor
 * acaban leyendo cosas distintas bajo el mismo identificador, y no hay forma de
 * saber cuál valía. Congelarlo es lo que lo convierte en una entrega y no en un
 * enlace.
 *
 * POR QUÉ LA LECTURA QUEDA FUERA DE LA TRANSACCIÓN
 *
 * La transacción envuelve solo la escritura del informe. Componerlo recorre la
 * red entera —hasta `MAX_GRAPH_NODES` expedientes, con sus notas, evidencia,
 * dictámenes y medidas—, y mantener una transacción abierta durante ese
 * recorrido bloquearía el conjunto de trabajo mucho más de lo que hace falta
 * para insertar una fila. Nada de lo que se lee se modifica aquí, así que lo
 * único que se pierde es la lectura consistente: el informe puede mezclar dos
 * instantes separados por milisegundos. Para una foto ejecutiva es aceptable;
 * `generatedAt` deja constancia de cuándo se tomó.
 */
export function createExportInvestigationUseCase(deps: ExportInvestigationDeps) {
  return async function exportInvestigation(
    input: ExportInvestigationInput,
  ): Promise<CaseReport> {
    // Valida tenant, existencia y pertenencia; si algo falla, revienta antes
    // de que se abra ninguna transacción.
    const summary = await deps.exportInvestigationSummary({
      auth: input.auth,
      investigationId: input.investigationId,
      includeCaseDetail: true,
      ...(input.maxDepth === undefined ? {} : { maxDepth: input.maxDepth }),
    });

    const report = CaseReportAggregate.create({
      id: deps.generateCaseReportId(),
      caseId: createCaseId(summary.investigation.caseId),
      organizationId: requireTenantContext(input.auth),
      generatedBy: input.auth.userId,
      snapshot: {
        reportType: 'INVESTIGATION_EXPORT',
        investigation: summary.investigation,
        network: summary.network,
        totals: summary.totals,
        cases: summary.cases,
        generatedAt: summary.generatedAt,
      },
      now: deps.clock.now(),
    });

    await deps.unitOfWork.withTransaction(async (tx) => {
      await deps.reports.save(report, tx);
    });
    return report;
  };
}
