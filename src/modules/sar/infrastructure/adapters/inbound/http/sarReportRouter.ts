import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import { fromDate } from '../../../../../../shared/time/Instant.js';
import type { createCreateSarReportDraftUseCase } from '../../../../application/CreateSarReportDraft.js';
import type { createApproveSarReportDraftUseCase } from '../../../../application/ApproveSarReportDraft.js';
import { createSarReportSchema } from './dto/sarReportSchemas.js';
import { toSarReportResponse } from './mappers/SarReportHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface SarReportRouterDeps {
  readonly createSarReportDraft: ReturnType<typeof createCreateSarReportDraftUseCase>;
  readonly approveSarReportDraft: ReturnType<typeof createApproveSarReportDraftUseCase>;
}

/**
 * `/sar-reports` routes — SAR-001 only (draft create). Express 5 forwards
 * rejected handler promises to `errorHandler`.
 */
export function sarReportRouter(deps: SarReportRouterDeps): Router {
  const router = Router();

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

  return router;
}
