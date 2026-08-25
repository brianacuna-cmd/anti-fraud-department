import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { ApprovalRequest } from '../domain/model/aggregates/ApprovalRequest.js';
import type { EnforcementAction } from '../domain/model/aggregates/EnforcementAction.js';
import type { ApprovalRequestRepository } from '../domain/ports/ApprovalRequestRepository.js';
import type { EnforcementActionRepository } from '../domain/ports/EnforcementActionRepository.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { OVERSIGHT_READ_ROLES, requireReadRole } from './authorization/policy.js';

/**
 * A request ALWAYS travels with the sanction that motivates it: reviewing it
 * blindly —without knowing whether it blocks a wallet or suspends a customer—
 * is not reviewing, it is signing.
 */
export interface PendingApproval {
  readonly approvalRequest: ApprovalRequest;
  readonly enforcementAction: EnforcementAction;
  /**
   * `false` when the caller is who requested the measure: they will see it in
   * the queue, they will know it is waiting, and they will not be able to
   * decide it (four eyes).
   */
  readonly reviewableByCaller: boolean;
}

export interface ListApprovalRequestsInput {
  readonly auth: AuthContext;
  readonly limit: number;
  readonly offset: number;
}

export interface ListApprovalRequestsResult {
  readonly items: readonly PendingApproval[];
  readonly total: number;
}

export interface ListApprovalRequestsDeps {
  readonly enforcementActions: EnforcementActionRepository;
  readonly approvalRequests: ApprovalRequestRepository;
}

/**
 * GET /approval-requests — the dual-control queue (ENF-002).
 *
 * Without this, four-eyes control had nowhere to be exercised: the requests
 * existed and so did the route to decide ONE by its id, but nothing answered
 * "what is waiting". A control nobody can see is a control that is not
 * exercised.
 *
 * The query starts from `enforcement_actions` and not from `approval_requests`
 * because the approval row does NOT carry `organization_id` (design: the
 * scope is inherited from the sanction), so it is the sanction that supplies
 * the tenant gate. As a side effect, order and pagination already come
 * resolved from the sanctions repository.
 */
export function createListApprovalRequestsUseCase(deps: ListApprovalRequestsDeps) {
  return async function listApprovalRequests(
    input: ListApprovalRequestsInput,
  ): Promise<ListApprovalRequestsResult> {
    requireReadRole(input.auth, OVERSIGHT_READ_ROLES);
    const organizationId = requireTenantContext(input.auth);

    const pendingActions = await deps.enforcementActions.list({
      organizationId,
      status: 'PENDING',
      limit: input.limit,
      offset: input.offset,
    });

    const items: PendingApproval[] = [];
    for (const enforcementAction of pendingActions.items) {
      const approvalRequest = await deps.approvalRequests.findByEnforcementActionId(
        enforcementAction.id,
      );
      // A PENDING sanction without a request is one from before ENF-002: the
      // queue omits it instead of inventing a row, and it remains approvable
      // through the direct route, which creates the request on the fly.
      if (approvalRequest === null || approvalRequest.status !== 'PENDING') {
        continue;
      }
      items.push({
        approvalRequest,
        enforcementAction,
        reviewableByCaller: approvalRequest.requesterId !== input.auth.userId,
      });
    }

    return { items, total: pendingActions.total };
  };
}
