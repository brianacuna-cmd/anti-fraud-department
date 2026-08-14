import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createRecordAnalystDecisionUseCase } from '../../../../application/RecordAnalystDecision.js';
import type { createApproveEnforcementActionUseCase } from '../../../../application/ApproveEnforcementAction.js';
import type { createRejectEnforcementActionUseCase } from '../../../../application/RejectEnforcementAction.js';
import type { createExecuteEnforcementActionUseCase } from '../../../../application/ExecuteEnforcementAction.js';
import {
  recordAnalystDecisionSchema,
  reviewEnforcementActionSchema,
} from './dto/enforcementSchemas.js';
import {
  toExecuteEnforcementActionResponse,
  toRecordAnalystDecisionResponse,
  toReviewEnforcementActionResponse,
} from './mappers/EnforcementHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface EnforcementRouterDeps {
  readonly recordAnalystDecision: ReturnType<typeof createRecordAnalystDecisionUseCase>;
  readonly approveEnforcementAction: ReturnType<typeof createApproveEnforcementActionUseCase>;
  readonly rejectEnforcementAction: ReturnType<typeof createRejectEnforcementActionUseCase>;
  readonly executeEnforcementAction: ReturnType<typeof createExecuteEnforcementActionUseCase>;
}

/**
 * Enforcement lifecycle HTTP routes (PR2–PR4).
 * Decisions: POST /cases/:caseId/decisions (ANALYST|SUPERVISOR|ADMIN).
 * Approve/reject: POST /enforcement-actions/:id/approve|reject (SUPERVISOR|ADMIN).
 * Execute: POST /enforcement-actions/:id/execute (SUPERVISOR|ADMIN).
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

  router.post('/enforcement-actions/:id/approve', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(reviewEnforcementActionSchema, req.body ?? {});
    const result = await deps.approveEnforcementAction({
      auth,
      enforcementActionId: req.params.id!,
      reviewerComment: body.reviewerComment ?? null,
    });
    res.status(200).json(toReviewEnforcementActionResponse(result));
  });

  router.post('/enforcement-actions/:id/reject', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(reviewEnforcementActionSchema, req.body ?? {});
    const result = await deps.rejectEnforcementAction({
      auth,
      enforcementActionId: req.params.id!,
      reviewerComment: body.reviewerComment ?? null,
    });
    res.status(200).json(toReviewEnforcementActionResponse(result));
  });

  router.post('/enforcement-actions/:id/execute', async (req, res) => {
    const auth = requireAuthContext(req);
    const result = await deps.executeEnforcementAction({
      auth,
      enforcementActionId: req.params.id!,
    });
    res.status(200).json(toExecuteEnforcementActionResponse(result));
  });

  return router;
}
