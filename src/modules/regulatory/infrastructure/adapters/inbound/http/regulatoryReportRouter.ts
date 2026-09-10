import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import { fromDate } from '../../../../../../shared/time/Instant.js';
import { createRegulatoryReportId } from '../../../../domain/model/value-objects/RegulatoryReportId.js';
import type { createCompileRegulatoryReportUseCase } from '../../../../application/CompileRegulatoryReport.js';
import type { createIssueRegulatoryReportUseCase } from '../../../../application/IssueRegulatoryReport.js';
import type { createExportRegulatoryReportUseCase } from '../../../../application/ExportRegulatoryReport.js';
import type { createGetRegulatoryReportUseCase } from '../../../../application/GetRegulatoryReport.js';
import type { createListRegulatoryReportsUseCase } from '../../../../application/ListRegulatoryReports.js';
import {
  compileRegulatoryReportSchema,
  exportRegulatoryReportQuerySchema,
  listRegulatoryReportsQuerySchema,
} from './dto/regulatoryReportSchemas.js';
import { toRegulatoryReportResponse } from './mappers/RegulatoryReportHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface RegulatoryReportRouterDeps {
  readonly compileRegulatoryReport: ReturnType<typeof createCompileRegulatoryReportUseCase>;
  readonly issueRegulatoryReport: ReturnType<typeof createIssueRegulatoryReportUseCase>;
  readonly exportRegulatoryReport: ReturnType<typeof createExportRegulatoryReportUseCase>;
  readonly getRegulatoryReport: ReturnType<typeof createGetRegulatoryReportUseCase>;
  readonly listRegulatoryReports: ReturnType<typeof createListRegulatoryReportsUseCase>;
}

/** Normaliza el `string | string[]` de zod para parámetros repetibles. */
function asArray<T>(value: T | T[] | undefined): readonly T[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

/**
 * Rutas `/regulatory-reports` (REG-001 y REG-002). Express 5 reenvía las
 * promesas rechazadas al `errorHandler`.
 */
export function regulatoryReportRouter(deps: RegulatoryReportRouterDeps): Router {
  const router = Router();

  // REG-001
  router.post('/regulatory-reports', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(compileRegulatoryReportSchema, req.body);
    const report = await deps.compileRegulatoryReport({
      auth,
      periodStart: fromDate(new Date(body.periodStart)),
      periodEnd: fromDate(new Date(body.periodEnd)),
      reportId: body.reportId === undefined ? undefined : createRegulatoryReportId(body.reportId),
    });
    // 201 al crear, 200 al recompilar: son cosas distintas y el cliente puede
    // querer distinguirlas sin comparar cuerpos.
    res.status(body.reportId === undefined ? 201 : 200).json(toRegulatoryReportResponse(report));
  });

  router.get('/regulatory-reports', async (req, res) => {
    const auth = requireAuthContext(req);
    const query = parseRequest(listRegulatoryReportsQuerySchema, req.query);
    const page = await deps.listRegulatoryReports({
      auth,
      status: asArray(query.status),
      limit: query.limit,
      offset: query.offset,
    });
    res.status(200).json({
      items: page.items.map(toRegulatoryReportResponse),
      total: page.total,
    });
  });

  router.get('/regulatory-reports/:id', async (req, res) => {
    const auth = requireAuthContext(req);
    const report = await deps.getRegulatoryReport({
      auth,
      reportId: createRegulatoryReportId(req.params.id!),
    });
    res.status(200).json(toRegulatoryReportResponse(report));
  });

  /** Cierra el borrador. A partir de aquí las cifras no se tocan. */
  router.patch('/regulatory-reports/:id/issue', async (req, res) => {
    const auth = requireAuthContext(req);
    const report = await deps.issueRegulatoryReport({
      auth,
      reportId: createRegulatoryReportId(req.params.id!),
    });
    res.status(200).json(toRegulatoryReportResponse(report));
  });

  // REG-002
  router.get('/regulatory-reports/:id/export', async (req, res) => {
    const auth = requireAuthContext(req);
    const query = parseRequest(exportRegulatoryReportQuerySchema, req.query);
    const file = await deps.exportRegulatoryReport({
      auth,
      reportId: createRegulatoryReportId(req.params.id!),
      format: query.format,
    });

    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    // Un borrador no se guarda en ninguna cache intermedia: la siguiente
    // compilacion cambia las cifras y el fichero servido quedaria obsoleto sin
    // que nadie lo note.
    res.setHeader('Cache-Control', file.issued ? 'private, max-age=300' : 'no-store');
    res.status(200).send(file.body);
  });

  return router;
}
