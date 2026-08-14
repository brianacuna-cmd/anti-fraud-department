import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createRecordAnalystDecisionUseCase } from '../../../../application/RecordAnalystDecision.js';
import { recordAnalystDecisionSchema } from './dto/enforcementSchemas.js';
import { toRecordAnalystDecisionResponse } from './mappers/EnforcementHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface EnforcementRouterDeps {
  readonly recordAnalystDecision: ReturnType<typeof createRecordAnalystDecisionUseCase>;
}

/**
 * Enforcement lifecycle HTTP routes (PR2+). Starts with
 * POST /cases/:caseId/decisions (ANALYST|SUPERVISOR|ADMIN via use case).
 * Approve/reject/execute routes land in later PR slices.
 */
export function enforcementRouter(deps: EnforcementRouterDeps): Router {
  const router = Router();

  router.post('/cases/:caseId/decisions', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(recordAnalystDecisionSchema, req.body);
    const result = await deps.recordAnalystDecision({
      auth,
      caseId: req.params.caseId!,
      decision: body.decision,
      confidence: body.confidence,
      comment: body.comment,
      actionType: body.actionType,
      targetType: body.targetType,
      targetId: body.targetId,
    });
    res.status(201).json(toRecordAnalystDecisionResponse(result));
  });

  return router;
}
