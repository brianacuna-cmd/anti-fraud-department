import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Instant } from '../../../shared/time/Instant.js';
import type { ApprovalRequestRepository } from '../domain/ports/ApprovalRequestRepository.js';
import type { UnitOfWork, Transaction } from '../domain/ports/UnitOfWork.js';
import type { ApprovalRequestId } from '../domain/model/value-objects/ApprovalRequestId.js';
import type { EnforcementAction } from '../domain/model/aggregates/EnforcementAction.js';
import type { CustomerOutgoingEvent } from '../domain/model/aggregates/CustomerOutgoingEvent.js';
import type { ApprovalRequest } from '../domain/model/aggregates/ApprovalRequest.js';
import { ApprovalRequest as ApprovalRequestAggregate } from '../domain/model/aggregates/ApprovalRequest.js';
import { createEnforcementActionId } from '../domain/model/value-objects/EnforcementActionId.js';
import {
  enforcementActionNotFound,
  forbiddenCrossTenant,
  invariantViolation,
} from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SUPERVISION_ROLES } from './authorization/policy.js';
import {
  canExecuteNow,
  executeEnforcementWithin,
  type EnforcementExecutionDeps,
} from './enforcementExecution.js';

export interface ApproveEnforcementActionInput {
  readonly auth: AuthContext;
  readonly enforcementActionId: string;
  readonly reviewerComment: string | null;
}

export interface ApproveEnforcementActionResult {
  readonly enforcementAction: EnforcementAction;
  readonly approvalRequest: ApprovalRequest;
  /** True when the approval also executed the measure (see below). */
  readonly executed: boolean;
  readonly outgoingEvent: CustomerOutgoingEvent | null;
}

export interface ApproveEnforcementActionDeps extends EnforcementExecutionDeps {
  readonly approvalRequests: ApprovalRequestRepository;
  readonly unitOfWork: UnitOfWork;
  readonly generateApprovalRequestId: () => ApprovalRequestId;
}

/**
 * Approves a PENDING non-REVIEW enforcement action. SUPERVISOR only; the
 * second pair of eyes is enforced by `ApprovalRequest.approve`.
 *
 * Approving IS executing: in the same transaction the approval_request and
 * the action move to APPROVED and the action is executed right away
 * (`executeEnforcementWithin`). A separate execute click after a supervisor
 * had already authorized the measure only added a step where it could be
 * forgotten. The one exception is fail-closed delivery: a
 * BLOCK/RESTRICT/SUSPEND/DELETE with no outbound webhook configured stays
 * APPROVED (`executed: false`) until the tenant configures it and someone
 * executes it.
 *
 * Creates the PENDING approval_request if none exists (legacy actions born
 * before requests were created at decision time).
 */
export function createApproveEnforcementActionUseCase(deps: ApproveEnforcementActionDeps) {
  return async function approveEnforcementAction(
    input: ApproveEnforcementActionInput,
  ): Promise<ApproveEnforcementActionResult> {
    requireOperationalRole(input.auth, SUPERVISION_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const enforcementActionId = createEnforcementActionId(input.enforcementActionId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const existing = await deps.enforcementActions.findById(enforcementActionId, tx);
      if (existing === null) {
        throw enforcementActionNotFound(enforcementActionId);
      }
      if (existing.organizationId !== organizationId) {
        throw forbiddenCrossTenant('enforcement action does not belong to the actor organization');
      }
      if (existing.actionType === 'REVIEW') {
        throw invariantViolation('REVIEW actions skip the approval gate', {
          actionType: existing.actionType,
        });
      }

      const now = deps.clock.now();
      const pendingApproval = await loadOrCreatePendingApproval(deps, existing, now, tx);
      const approvalRequest = pendingApproval.approve({
        reviewerId: input.auth.userId,
        reviewerComment: input.reviewerComment,
        now,
      });
      const enforcementAction = existing.approve(now);

      await deps.approvalRequests.save(approvalRequest, tx);
      await deps.enforcementActions.save(enforcementAction, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'APPROVE_ENFORCEMENT_ACTION',
          resource: 'case',
          resourceId: enforcementAction.caseId,
          detail: {
            enforcementActionId: enforcementAction.id,
            approvalRequestId: approvalRequest.id,
            actionType: enforcementAction.actionType,
            reviewerComment: input.reviewerComment,
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      if (!(await canExecuteNow(deps, enforcementAction, tx))) {
        return { enforcementAction, approvalRequest, executed: false, outgoingEvent: null };
      }
      const execution = await executeEnforcementWithin(deps, enforcementAction, input.auth, tx);
      return {
        enforcementAction: execution.enforcementAction,
        approvalRequest,
        executed: true,
        outgoingEvent: execution.outgoingEvent,
      };
    });
  };
}

async function loadOrCreatePendingApproval(
  deps: ApproveEnforcementActionDeps,
  action: EnforcementAction,
  now: Instant,
  tx: Transaction | undefined,
): Promise<ApprovalRequest> {
  const existing = await deps.approvalRequests.findByEnforcementActionId(action.id, tx);
  if (existing !== null) {
    return existing;
  }
  return ApprovalRequestAggregate.create({
    id: deps.generateApprovalRequestId(),
    enforcementActionId: action.id,
    requesterId: action.createdBy,
    now,
  });
}
