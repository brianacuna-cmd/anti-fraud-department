import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createGenerateCaseReportUseCase } from '../../../../application/GenerateCaseReport.js';
import { toCaseReportResponse } from './mappers/CaseReportHttpMapper.js';

export interface ReportRouterDeps {
  readonly generateCaseReport: ReturnType<typeof createGenerateCaseReportUseCase>;
}

/**
 * Case report routes (separate router so `caseRouter` deps stay stable).
 * PR1: POST /cases/:caseId/reports (generate + persist a snapshot). Read
 * routes (GET) land in PR2. Mounted on the authenticated /api/v1 router.
 */
export function reportRouter(deps: ReportRouterDeps): Router {
  const router = Router();

  router.post('/cases/:caseId/reports', async (req, res) => {
    const auth = requireAuthContext(req);
    const report = await deps.generateCaseReport({ auth, caseId: req.params.caseId! });
    res.status(201).json(toCaseReportResponse(report));
  });

  return router;
}
