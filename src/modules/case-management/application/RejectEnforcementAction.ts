import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { EnforcementActionRepository } from '../domain/ports/EnforcementActionRepository.js';
import type { ApprovalRequestRepository } from '../domain/ports/ApprovalRequestRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { ApprovalRequestId } from '../domain/model/value-objects/ApprovalRequestId.js';
import type { EnforcementAction } from '../domain/model/aggregates/EnforcementAction.js';
import type { ApprovalRequest } from '../domain/model/aggregates/ApprovalRequest.js';
import { ApprovalRequest as ApprovalRequestAggregate } from '../domain/model/aggregates/ApprovalRequest.js';
import { createEnforcementActionId } from '../domain/model/value-objects/EnforcementActionId.js';
import {
  enforcementActionNotFound,
  forbiddenCrossTenant,
  invariantViolation,
} from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireRole } from './authorization/requireRole.js';

const APPROVAL_ROLES = ['SUPERVISOR', 'ADMIN'] as const;

export interface RejectEnforcementActionInput {
  readonly auth: AuthContext;
  readonly enforcementActionId: string;
  readonly reviewerComment: string | null;
}

export interface RejectEnforcementActionResult {
  readonly enforcementAction: EnforcementAction;
  readonly approvalRequest: ApprovalRequest;
}

export interface RejectEnforcementActionDeps {
  readonly enforcementActions: EnforcementActionRepository;
  readonly approvalRequests: ApprovalRequestRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateApprovalRequestId: () => ApprovalRequestId;
}

/**
 * Rejects a PENDING non-REVIEW enforcement action (PR3). SUPERVISOR|ADMIN
 * only. Transitions approval_requests PENDING→REJECTED and the action
 * PENDING→REJECTED. Rejected actions MUST NOT execute (PR4 gate).
 * REVIEW skips the approval gate entirely.
 */
export function createRejectEnforcementActionUseCase(deps: RejectEnforcementActionDeps) {
  return async function rejectEnforcementAction(
    input: RejectEnforcementActionInput,
  ): Promise<RejectEnforcementActionResult> {
    requireRole(input.auth, APPROVAL_ROLES);
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
      let pendingApproval = await deps.approvalRequests.findByEnforcementActionId(
        existing.id,
        tx,
      );
      if (pendingApproval === null) {
        pendingApproval = ApprovalRequestAggregate.create({
          id: deps.generateApprovalRequestId(),
          enforcementActionId: existing.id,
          requesterId: existing.createdBy,
          now,
        });
      }

      const approvalRequest = pendingApproval.reject({
        reviewerId: input.auth.userId,
        reviewerComment: input.reviewerComment,
        now,
      });
      const enforcementAction = existing.reject(now);

      await deps.approvalRequests.save(approvalRequest, tx);
      await deps.enforcementActions.save(enforcementAction, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'REJECT_ENFORCEMENT_ACTION',
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

      return { enforcementAction, approvalRequest };
    });
  };
}
