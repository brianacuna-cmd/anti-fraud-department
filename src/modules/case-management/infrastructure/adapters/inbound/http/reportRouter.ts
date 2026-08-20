import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createGenerateCaseReportUseCase } from '../../../../application/GenerateCaseReport.js';
import type { createListCaseReportsUseCase } from '../../../../application/ListCaseReports.js';
import type { createGetCaseReportUseCase } from '../../../../application/GetCaseReport.js';
import { toCaseReportResponse } from './mappers/CaseReportHttpMapper.js';

export interface ReportRouterDeps {
  readonly generateCaseReport: ReturnType<typeof createGenerateCaseReportUseCase>;
  readonly listCaseReports: ReturnType<typeof createListCaseReportsUseCase>;
  readonly getCaseReport: ReturnType<typeof createGetCaseReportUseCase>;
}

/**
 * Case report routes (separate router so `caseRouter` deps stay stable):
 * POST /cases/:caseId/reports (generate + persist), GET /cases/:caseId/reports
 * (list), GET /reports/:reportId (detail). Mounted on the authenticated
 * /api/v1 router.
 */
export function reportRouter(deps: ReportRouterDeps): Router {
  const router = Router();

  router.post('/cases/:caseId/reports', async (req, res) => {
    const auth = requireAuthContext(req);
    const report = await deps.generateCaseReport({ auth, caseId: req.params.caseId! });
    res.status(201).json(toCaseReportResponse(report));
  });

  router.get('/cases/:caseId/reports', async (req, res) => {
    const auth = requireAuthContext(req);
    const reports = await deps.listCaseReports({ auth, caseId: req.params.caseId! });
    res.status(200).json({ items: reports.map(toCaseReportResponse) });
  });

  router.get('/reports/:reportId', async (req, res) => {
    const auth = requireAuthContext(req);
    const report = await deps.getCaseReport({ auth, reportId: req.params.reportId! });
    res.status(200).json(toCaseReportResponse(report));
  });

  return router;
}
