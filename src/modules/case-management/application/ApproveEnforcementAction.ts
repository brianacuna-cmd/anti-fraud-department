import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Instant } from '../../../shared/time/Instant.js';
import type { EnforcementActionRepository } from '../domain/ports/EnforcementActionRepository.js';
import type { ApprovalRequestRepository } from '../domain/ports/ApprovalRequestRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork, Transaction } from '../domain/ports/UnitOfWork.js';
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

export interface ApproveEnforcementActionInput {
  readonly auth: AuthContext;
  readonly enforcementActionId: string;
  readonly reviewerComment: string | null;
}

export interface ApproveEnforcementActionResult {
  readonly enforcementAction: EnforcementAction;
  readonly approvalRequest: ApprovalRequest;
}

export interface ApproveEnforcementActionDeps {
  readonly enforcementActions: EnforcementActionRepository;
  readonly approvalRequests: ApprovalRequestRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateApprovalRequestId: () => ApprovalRequestId;
}

/**
 * Approves a PENDING non-REVIEW enforcement action (PR3). SUPERVISOR|ADMIN
 * only. Transitions approval_requests PENDING→APPROVED and the action
 * PENDING→APPROVED in one UoW. REVIEW skips this gate (execute in PR4).
 * Creates a PENDING approval_request if none exists yet (PR2 does not
 * create them at decision time).
 */
export function createApproveEnforcementActionUseCase(deps: ApproveEnforcementActionDeps) {
  return async function approveEnforcementAction(
    input: ApproveEnforcementActionInput,
  ): Promise<ApproveEnforcementActionResult> {
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

      return { enforcementAction, approvalRequest };
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
