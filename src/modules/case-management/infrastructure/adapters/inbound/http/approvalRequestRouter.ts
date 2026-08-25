import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createReviewApprovalRequestUseCase } from '../../../../application/ReviewApprovalRequest.js';
import type { createListApprovalRequestsUseCase } from '../../../../application/ListApprovalRequests.js';
import { listApprovalRequestsQuerySchema, reviewApprovalRequestSchema } from './dto/enforcementSchemas.js';
import {
  toPendingApprovalResponse,
  toReviewEnforcementActionResponse,
} from './mappers/EnforcementHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface ApprovalRequestRouterDeps {
  readonly reviewApprovalRequest: ReturnType<typeof createReviewApprovalRequestUseCase>;
  readonly listApprovalRequests: ReturnType<typeof createListApprovalRequestsUseCase>;
}

/**
 * Approval-request routes (separate router so the busy enforcement/case
 * routers stay stable). GET /approval-requests is the dual-control queue —
 * what is waiting for a second pair of eyes; PATCH /approval-requests/:id/review
 * lets a supervisor authorize (APPROVED) or deny (REJECTED) a requested
 * sanction with a mandatory comment. Mounted on the authenticated /api/v1
 * router.
 */
export function approvalRequestRouter(deps: ApprovalRequestRouterDeps): Router {
  const router = Router();

  router.get('/approval-requests', async (req, res) => {
    const auth = requireAuthContext(req);
    const query = parseRequest(listApprovalRequestsQuerySchema, req.query);
    const result = await deps.listApprovalRequests({
      auth,
      limit: query.limit,
      offset: query.offset,
    });
    res.status(200).json({
      items: result.items.map(toPendingApprovalResponse),
      total: result.total,
    });
  });

  router.patch('/approval-requests/:id/review', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(reviewApprovalRequestSchema, req.body);
    const result = await deps.reviewApprovalRequest({
      auth,
      approvalRequestId: req.params.id!,
      decision: body.decision,
      comment: body.comment,
    });
    res.status(200).json(toReviewEnforcementActionResponse(result));
  });

  return router;
}
