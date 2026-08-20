import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createReviewApprovalRequestUseCase } from '../../../../application/ReviewApprovalRequest.js';
import { reviewApprovalRequestSchema } from './dto/enforcementSchemas.js';
import { toReviewEnforcementActionResponse } from './mappers/EnforcementHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface ApprovalRequestRouterDeps {
  readonly reviewApprovalRequest: ReturnType<typeof createReviewApprovalRequestUseCase>;
}

/**
 * Approval-request routes (separate router so the busy enforcement/case
 * routers stay stable). PATCH /approval-requests/:id/review lets a supervisor
 * authorize (APPROVED) or deny (REJECTED) a requested sanction with a mandatory
 * comment. Mounted on the authenticated /api/v1 router.
 */
export function approvalRequestRouter(deps: ApprovalRequestRouterDeps): Router {
  const router = Router();

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
