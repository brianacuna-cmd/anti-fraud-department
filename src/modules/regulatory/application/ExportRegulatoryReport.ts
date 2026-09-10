import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { RegulatoryReportId } from '../domain/model/value-objects/RegulatoryReportId.js';
import type { RegulatoryReportRepository } from '../domain/ports/RegulatoryReportRepository.js';
import type { ReportFormat, ReportRenderer } from '../domain/ports/ReportRenderer.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import { invariantViolation, regulatoryReportNotFound } from '../domain/errors/RegulatoryError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface ExportRegulatoryReportResult {
  readonly body: Buffer;
  readonly contentType: string;
  readonly filename: string;
  readonly issued: boolean;
}

export interface ExportRegulatoryReportDeps {
  readonly reports: RegulatoryReportRepository;
  readonly renderers: readonly ReportRenderer[];
  readonly auditRecorder: AuditRecorder;
}

/**
 * REG-002: genera el fichero listo para presentar.
 *
 * Se permite exportar un BORRADOR además de un emitido. Prohibirlo sonaría
 * prudente y sería contraproducente: quien tiene que revisar las cifras antes
 * de firmarlas necesita verlas maquetadas, y si la única forma de conseguir el
 * PDF fuera emitir, se emitiría para revisar. El renderizador marca el borrador
 * en la propia portada, que es donde la advertencia sirve — en el papel que
 * alguien podría reenviar por error.
 *
 * La auditoría se escribe FUERA de transacción porque no hay nada que escribir
 * junto a ella: exportar no cambia el reporte. Es un registro de acceso, y su
 * fallo no debe impedir la entrega del documento.
 */
export function createExportRegulatoryReportUseCase(deps: ExportRegulatoryReportDeps) {
  return async function exportRegulatoryReport(input: {
    readonly auth: AuthContext;
    readonly reportId: RegulatoryReportId;
    readonly format: ReportFormat;
  }): Promise<ExportRegulatoryReportResult> {
    const organizationId = requireTenantContext(input.auth);

    const report = await deps.reports.findById(input.reportId);
    if (report === null || report.organizationId !== organizationId) {
      throw regulatoryReportNotFound(input.reportId);
    }

    const renderer = deps.renderers.find((r) => r.format === input.format);
    if (renderer === undefined) {
      throw invariantViolation(`unsupported export format "${input.format}"`, {
        format: input.format,
        supported: deps.renderers.map((r) => r.format),
      });
    }

    const body = await renderer.render(report);

    await deps.auditRecorder.record({
      organizationId,
      actorType: input.auth.actorType,
      actorId: input.auth.userId,
      action: 'EXPORT_REGULATORY_REPORT',
      resource: 'regulatory_report',
      resourceId: report.id,
      detail: {
        format: renderer.format,
        status: report.status,
        periodStart: report.periodStart,
        periodEnd: report.periodEnd,
        bytes: body.byteLength,
      },
      ipAddress: input.auth.ipAddress,
    });

    return {
      body,
      contentType: renderer.contentType,
      // El nombre lleva el periodo, no la fecha de descarga: así dos ficheros
      // del mismo mes bajados en días distintos no compiten en la carpeta de
      // quien los archiva.
      filename: `reporte-regulatorio-${report.periodStart.slice(0, 10)}_${report.periodEnd.slice(0, 10)}.${renderer.extension}`,
      issued: report.status === 'ISSUED',
    };
  };
}
