import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createListApprovalRequestsUseCase } from '../../../../application/ListApprovalRequests.js';
import { listApprovalRequestsQuerySchema } from './dto/enforcementSchemas.js';
import { toPendingApprovalResponse } from './mappers/EnforcementHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface ApprovalRequestRouterDeps {
  readonly listApprovalRequests: ReturnType<typeof createListApprovalRequestsUseCase>;
}

/**
 * Approval-request routes (separate router so the busy enforcement/case
 * routers stay stable). GET /approval-requests is the dual-control queue —
 * what is waiting for a second pair of eyes. Deciding on a request goes
 * through POST /enforcement-actions/:id/approve|reject, the single review
 * path. Mounted on the authenticated /api/v1 router.
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

  return router;
}
