import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { EnforcementActionRepository } from '../domain/ports/EnforcementActionRepository.js';
import type { ApprovalRequestRepository } from '../domain/ports/ApprovalRequestRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { EnforcementAction } from '../domain/model/aggregates/EnforcementAction.js';
import type { ApprovalRequest } from '../domain/model/aggregates/ApprovalRequest.js';
import { createApprovalRequestId } from '../domain/model/value-objects/ApprovalRequestId.js';
import {
  approvalRequestNotFound,
  enforcementActionNotFound,
  forbiddenCrossTenant,
  invariantViolation,
} from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SUPERVISION_ROLES } from './authorization/policy.js';

export type ApprovalDecision = 'APPROVED' | 'REJECTED';

export interface ReviewApprovalRequestInput {
  readonly auth: AuthContext;
  readonly approvalRequestId: string;
  readonly decision: ApprovalDecision;
  readonly comment: string;
}

export interface ReviewApprovalRequestResult {
  readonly enforcementAction: EnforcementAction;
  readonly approvalRequest: ApprovalRequest;
}

export interface ReviewApprovalRequestDeps {
  readonly approvalRequests: ApprovalRequestRepository;
  readonly enforcementActions: EnforcementActionRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

/**
 * PATCH /approval-requests/:id/review — a supervisor authorizes (APPROVED) or
 * denies (REJECTED) a requested sanction, keyed on the approval request itself.
 * SUPERVISOR only; a non-empty `comment` is mandatory. Tenant scope is
 * derived from the linked enforcement action (ApprovalRequest carries no org).
 * Within ONE transaction: transition the approval_request and cascade the
 * decision onto its enforcement_action (PENDING -> APPROVED|REJECTED), then
 * audit. Re-reviewing a non-PENDING request throws `invalidTransition` (422).
 * Scope: approval_requests, enforcement_actions, audit_logs.
 */
export function createReviewApprovalRequestUseCase(deps: ReviewApprovalRequestDeps) {
  return async function reviewApprovalRequest(
    input: ReviewApprovalRequestInput,
  ): Promise<ReviewApprovalRequestResult> {
    requireOperationalRole(input.auth, SUPERVISION_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const approvalRequestId = createApprovalRequestId(input.approvalRequestId);
    const comment = input.comment.trim();
    if (comment.length === 0) {
      throw invariantViolation('a review comment is required', { field: 'comment' });
    }

    return deps.unitOfWork.withTransaction(async (tx) => {
      const approvalRequest = await deps.approvalRequests.findById(approvalRequestId, tx);
      if (approvalRequest === null) {
        throw approvalRequestNotFound(approvalRequestId);
      }

      const action = await deps.enforcementActions.findById(approvalRequest.enforcementActionId, tx);
      if (action === null) {
        throw enforcementActionNotFound(approvalRequest.enforcementActionId);
      }
      if (action.organizationId !== organizationId) {
        throw forbiddenCrossTenant('approval request does not belong to the actor organization');
      }

      const now = deps.clock.now();
      const review = { reviewerId: input.auth.userId, reviewerComment: comment, now };
      const reviewedRequest =
        input.decision === 'APPROVED' ? approvalRequest.approve(review) : approvalRequest.reject(review);
      const enforcementAction =
        input.decision === 'APPROVED' ? action.approve(now) : action.reject(now);

      await deps.approvalRequests.save(reviewedRequest, tx);
      await deps.enforcementActions.save(enforcementAction, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'REVIEW_APPROVAL_REQUEST',
          resource: 'case',
          resourceId: enforcementAction.caseId,
          detail: {
            approvalRequestId: reviewedRequest.id,
            enforcementActionId: enforcementAction.id,
            decision: input.decision,
            comment,
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return { enforcementAction, approvalRequest: reviewedRequest };
    });
  };
}
