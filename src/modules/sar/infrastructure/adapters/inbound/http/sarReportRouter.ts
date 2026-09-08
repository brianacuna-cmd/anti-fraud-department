import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import { fromDate } from '../../../../../../shared/time/Instant.js';
import type { createCreateSarReportDraftUseCase } from '../../../../application/CreateSarReportDraft.js';
import type { createApproveSarReportDraftUseCase } from '../../../../application/ApproveSarReportDraft.js';
import type { createGetSarReportUseCase } from '../../../../application/GetSarReport.js';
import { requireOperationalRole, SAR_WRITE_ROLES } from '../../../../application/authorization/policy.js';
import { createSarReportSchema } from './dto/sarReportSchemas.js';
import { toSarReportResponse } from './mappers/SarReportHttpMapper.js';
import { parseRequest } from './parseRequest.js';
import { SarXmlRenderer } from './xml/SarXmlRenderer.js';

export interface SarReportRouterDeps {
  readonly createSarReportDraft: ReturnType<typeof createCreateSarReportDraftUseCase>;
  readonly approveSarReportDraft: ReturnType<typeof createApproveSarReportDraftUseCase>;
  readonly getSarReport: ReturnType<typeof createGetSarReportUseCase>;
}

/**
 * `/sar-reports` routes: create draft (SAR-001), approve/lock (SAR-002),
 * detail read and filing XML (SAR-003). Express 5 forwards rejected
 * handler promises to `errorHandler`.
 */
export function sarReportRouter(deps: SarReportRouterDeps): Router {
  const router = Router();
  // Stateless: one instance for the whole router, like the renderers in
  // case-management's `reportRouter`/`caseExportRouter`.
  const xml = new SarXmlRenderer();

  router.post('/sar-reports', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(createSarReportSchema, req.body);
    const report = await deps.createSarReportDraft({
      auth,
      caseId: body.caseId,
      amlAlertId: body.amlAlertId,
      narrative: body.narrative,
      subjectName: body.subjectName,
      suspiciousAmount: body.suspiciousAmount,
      activityStartDate: body.activityStartDate ? fromDate(new Date(body.activityStartDate)) : null,
      activityEndDate: body.activityEndDate ? fromDate(new Date(body.activityEndDate)) : null,
    });
    res.status(201).json(toSarReportResponse(report));
  });

  router.patch('/sar-reports/:id/approve', async (req, res) => {
    const auth = requireAuthContext(req);
    const report = await deps.approveSarReportDraft({ auth, sarReportId: req.params.id! });
    res.status(200).json(toSarReportResponse(report));
  });

  router.get('/sar-reports/:id', async (req, res) => {
    const auth = requireAuthContext(req);
    const report = await deps.getSarReport({ auth, sarReportId: req.params.id! });
    res.status(200).json(toSarReportResponse(report));
  });

  /**
   * SAR-003. Compiling the official filing XML is an act of authority like
   * approving the report, so it is restricted to `SAR_WRITE_ROLES`, unlike
   * the plain JSON detail above which any tenant actor may read.
   *
   * `attachment` and not `inline`: the filing document is archived or
   * handed off, and the filename carries the report id so it stays
   * identifiable outside the application (same reasoning as case-management's
   * `GET /reports/:reportId/pdf`).
   */
  router.get('/sar-reports/:id/xml', async (req, res) => {
    const auth = requireAuthContext(req);
    requireOperationalRole(auth, SAR_WRITE_ROLES);
    const report = await deps.getSarReport({ auth, sarReportId: req.params.id! });
    const body = xml.render(report);

    res.setHeader('Content-Type', xml.contentType);
    res.setHeader('Content-Length', String(body.length));
    res.setHeader('Content-Disposition', `attachment; filename="sar-${report.id}.xml"`);
    res.status(200).send(body);
  });

  return router;
}
