import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { Instant } from '../../../../../../shared/time/Instant.js';
import type { createExportCasesUseCase } from '../../../../application/ExportCases.js';
import { exportCasesQuerySchema } from './dto/caseSchemas.js';
import { parseRequest } from './parseRequest.js';
import { toCaseExportRow } from './export/CaseExportRow.js';
import type { CaseExportRenderer, CaseExportFormat } from './export/CaseExportRenderer.js';
import { JsonCaseExportRenderer } from './export/JsonCaseExportRenderer.js';
import { XlsxCaseExportRenderer } from './export/XlsxCaseExportRenderer.js';
import { PdfCaseExportRenderer } from './export/PdfCaseExportRenderer.js';

export interface CaseExportRouterDeps {
  readonly exportCases: ReturnType<typeof createExportCasesUseCase>;
}

/**
 * Case export route (separate router so the busy `caseRouter` deps stay
 * stable). GET /cases/export?format=json|xlsx|pdf streams a downloadable
 * document. MUST be mounted BEFORE `caseRouter` so `/cases/export` is not
 * shadowed by `GET /cases/:caseId`.
 */
export function caseExportRouter(deps: CaseExportRouterDeps): Router {
  const renderers: Record<CaseExportFormat, CaseExportRenderer> = {
    json: new JsonCaseExportRenderer(),
    xlsx: new XlsxCaseExportRenderer(),
    pdf: new PdfCaseExportRenderer(),
  };
  const router = Router();

  router.get('/cases/export', async (req, res) => {
    const auth = requireAuthContext(req);
    const query = parseRequest(exportCasesQuerySchema, req.query);
    const result = await deps.exportCases({
      auth,
      status: query.status,
      priority: query.priority,
      assignedToId: query.assignedTo,
      riskScoreMin: query.riskScoreMin,
      riskScoreMax: query.riskScoreMax,
      tags: query.tags,
      dueAfter: query.dueAfter as Instant | undefined,
      dueBefore: query.dueBefore as Instant | undefined,
    });

    const renderer = renderers[query.format];
    const rows = result.rows.map(toCaseExportRow);
    const body = await renderer.render(rows);

    const filename = `cases-export-${new Date().toISOString().slice(0, 10)}.${renderer.extension}`;
    res.setHeader('Content-Type', renderer.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Total-Count', String(result.total));
    res.setHeader('X-Export-Truncated', String(result.truncated));
    res.status(200).send(body);
  });

  return router;
}
