import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createRecordAnalystDecisionUseCase } from '../../../../application/RecordAnalystDecision.js';
import type { createRequestEnforcementActionUseCase } from '../../../../application/RequestEnforcementAction.js';
import type { createListCaseDecisionsUseCase } from '../../../../application/ListCaseDecisions.js';
import type { createApproveEnforcementActionUseCase } from '../../../../application/ApproveEnforcementAction.js';
import type { createRejectEnforcementActionUseCase } from '../../../../application/RejectEnforcementAction.js';
import type { createExecuteEnforcementActionUseCase } from '../../../../application/ExecuteEnforcementAction.js';
import type { createRevertEnforcementActionUseCase } from '../../../../application/RevertEnforcementAction.js';
import type { createListEnforcementActionsUseCase } from '../../../../application/ListEnforcementActions.js';
import {
  recordAnalystDecisionSchema,
  requestEnforcementActionSchema,
  reviewEnforcementActionSchema,
  listEnforcementActionsQuerySchema,
} from './dto/enforcementSchemas.js';
import {
  toAnalystDecisionResponse,
  toExecuteEnforcementActionResponse,
  toRecordAnalystDecisionResponse,
  toReviewEnforcementActionResponse,
  toEnforcementActionResponse,
} from './mappers/EnforcementHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface EnforcementRouterDeps {
  readonly recordAnalystDecision: ReturnType<typeof createRecordAnalystDecisionUseCase>;
  readonly requestEnforcementAction: ReturnType<typeof createRequestEnforcementActionUseCase>;
  readonly listCaseDecisions: ReturnType<typeof createListCaseDecisionsUseCase>;
  readonly approveEnforcementAction: ReturnType<typeof createApproveEnforcementActionUseCase>;
  readonly rejectEnforcementAction: ReturnType<typeof createRejectEnforcementActionUseCase>;
  readonly executeEnforcementAction: ReturnType<typeof createExecuteEnforcementActionUseCase>;
  readonly revertEnforcementAction: ReturnType<typeof createRevertEnforcementActionUseCase>;
  readonly listEnforcementActions: ReturnType<typeof createListEnforcementActionsUseCase>;
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

  /** Decisions already issued. Without this the case card does not know what was concluded. */
  router.get('/cases/:caseId/decisions', async (req, res) => {
    const auth = requireAuthContext(req);
    const decisions = await deps.listCaseDecisions({ auth, caseId: req.params.caseId! });
    res.status(200).json({ items: decisions.map(toAnalystDecisionResponse) });
  });

  // ENF-001: request a measure against an already recorded decision, without
  // having to re-decide the case just to add a second sanction.
  router.post('/cases/:caseId/enforcement-actions', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(requestEnforcementActionSchema, req.body);
    const result = await deps.requestEnforcementAction({
      auth,
      caseId: req.params.caseId!,
      analystDecisionId: body.analystDecisionId,
      actionType: body.actionType,
      targetType: body.targetType,
      targetId: body.targetId,
    });
    res.status(201).json({
      enforcementAction: toEnforcementActionResponse(result.enforcementAction),
      approvalRequestId: result.approvalRequest?.id ?? null,
    });
  });

  router.get('/enforcement-actions', async (req, res) => {
    const auth = requireAuthContext(req);
    const query = parseRequest(listEnforcementActionsQuerySchema, req.query);
    const result = await deps.listEnforcementActions({
      auth,
      status: query.status,
      actionType: query.actionType,
      targetType: query.targetType,
      targetId: query.targetId,
      caseId: query.caseId,
      limit: query.limit,
      offset: query.offset,
    });
    res.status(200).json({
      items: result.items.map(toEnforcementActionResponse),
      total: result.total,
    });
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

  router.post('/enforcement-actions/:id/revert', async (req, res) => {
    const auth = requireAuthContext(req);
    const enforcementAction = await deps.revertEnforcementAction({
      auth,
      enforcementActionId: req.params.id!,
    });
    res.status(200).json(toEnforcementActionResponse(enforcementAction));
  });

  return router;
}
