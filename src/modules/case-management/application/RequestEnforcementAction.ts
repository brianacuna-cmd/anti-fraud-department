import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { AnalystDecisionRepository } from '../domain/ports/AnalystDecisionRepository.js';
import type { ApprovalRequestRepository } from '../domain/ports/ApprovalRequestRepository.js';
import type { AssigneeDirectory } from '../domain/ports/AssigneeDirectory.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { EnforcementActionRepository } from '../domain/ports/EnforcementActionRepository.js';
import type { NotificationSender } from '../domain/ports/NotificationSender.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { ApprovalRequestId } from '../domain/model/value-objects/ApprovalRequestId.js';
import type { EnforcementActionId } from '../domain/model/value-objects/EnforcementActionId.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import { ApprovalRequest } from '../domain/model/aggregates/ApprovalRequest.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { EnforcementAction } from '../domain/model/aggregates/EnforcementAction.js';
import { createAnalystDecisionId } from '../domain/model/value-objects/AnalystDecisionId.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { createEnforcementActionType } from '../domain/model/value-objects/EnforcementActionType.js';
import { assertAssigned } from '../domain/services/AssignmentGate.js';
import { assertNotClosed } from '../domain/services/ClosedCaseGate.js';
import {
  caseNotFound,
  forbiddenCrossTenant,
  invariantViolation,
} from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, CASE_WORK_ROLES } from './authorization/policy.js';
import { notifyApprovers } from './notifyApprovers.js';

export interface RequestEnforcementActionInput {
  readonly auth: AuthContext;
  readonly caseId: string;
  /** Analyst decision that motivates the sanction. Required: see the use-case note. */
  readonly analystDecisionId: string;
  readonly actionType: string;
  readonly targetType: string;
  readonly targetId: string;
}

export interface RequestEnforcementActionResult {
  readonly enforcementAction: EnforcementAction;
  /** `null` only for `REVIEW`, which restricts nothing and skips four-eyes. */
  readonly approvalRequest: ApprovalRequest | null;
}

export interface RequestEnforcementActionDeps {
  readonly cases: CaseRepository;
  readonly decisions: AnalystDecisionRepository;
  readonly enforcementActions: EnforcementActionRepository;
  readonly approvalRequests: ApprovalRequestRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly notificationSender: NotificationSender;
  readonly assigneeDirectory: AssigneeDirectory;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateEnforcementActionId: () => EnforcementActionId;
  readonly generateApprovalRequestId: () => ApprovalRequestId;
  readonly generateTimelineEventId: () => TimelineEventId;
}

/**
 * ENF-001 — standalone request for a precautionary measure.
 *
 * POST /cases/:caseId/enforcement-actions
 *
 * Until now a sanction could only be born as a side effect of
 * `RecordAnalystDecision`, which forced recording another decision just
 * to request a second measure — freeze the wallet and also suspend the
 * customer — and left two analyst decisions on the case where the analyst
 * only made one call.
 *
 * What is NOT relaxed is the link to the decision: `EnforcementAction`
 * requires `analystDecisionId` and this use case still requires it. A
 * sanction with no recorded verdict is a restriction on someone's money
 * that nobody signed, and that is exactly the case that cannot be
 * defended before a regulator. The decision is validated against the
 * case: it must exist, belong to this case, and belong to this tenant.
 *
 * Four-eyes (ENF-002) fire the same way as on a decision and in the same
 * transaction, reusing `notifyApprovers`: the two doors through which a
 * sanction is born open the same queue.
 */
export function createRequestEnforcementActionUseCase(deps: RequestEnforcementActionDeps) {
  return async function requestEnforcementAction(
    input: RequestEnforcementActionInput,
  ): Promise<RequestEnforcementActionResult> {
    requireOperationalRole(input.auth, CASE_WORK_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const caseId = createCaseId(input.caseId);
    const analystDecisionId = createAnalystDecisionId(input.analystDecisionId);
    const actionType = createEnforcementActionType(input.actionType);
    assertTarget(input);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const existing = await deps.cases.findById(caseId, tx);
      if (existing === null || existing.deletedAt !== null) {
        throw caseNotFound(caseId);
      }
      if (existing.organizationId !== organizationId) {
        throw forbiddenCrossTenant('case does not belong to the actor organization');
      }
      // Without an assignee the case is frozen. See `AssignmentGate`.
      assertAssigned(existing);
      // A closed case is not worked. See `ClosedCaseGate`.
      assertNotClosed(existing);

      const decision = await deps.decisions.findById(analystDecisionId, tx);
      if (decision === null || decision.caseId !== existing.id) {
        throw invariantViolation('analystDecisionId must reference a decision of this case', {
          analystDecisionId,
          caseId: existing.id,
        });
      }
      if (decision.organizationId !== organizationId) {
        throw forbiddenCrossTenant('analyst decision does not belong to the actor organization');
      }

      const now = deps.clock.now();
      const enforcementAction = EnforcementAction.create({
        id: deps.generateEnforcementActionId(),
        caseId: existing.id,
        organizationId,
        analystDecisionId: decision.id,
        actionType,
        targetType: input.targetType,
        targetId: input.targetId,
        createdBy: input.auth.userId,
        now,
      });
      await deps.enforcementActions.save(enforcementAction, tx);

      const approvalRequest = await openApproval(deps, {
        enforcementAction,
        organizationId,
        caseId: existing.id,
        requesterId: input.auth.userId,
        now,
        tx,
      });

      const timelineEvent = CaseTimelineEvent.create({
        id: deps.generateTimelineEventId(),
        caseId: existing.id,
        eventType: 'ENFORCEMENT_REQUESTED',
        previousValue: null,
        newValue: actionType,
        createdBy: input.auth.userId,
        createdAt: now,
      });
      await deps.timelineRecorder.record(timelineEvent, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'REQUEST_ENFORCEMENT_ACTION',
          resource: 'enforcement_action',
          resourceId: enforcementAction.id,
          detail: {
            caseId: existing.id,
            analystDecisionId: decision.id,
            actionType,
            targetType: input.targetType,
            targetId: input.targetId,
            approvalRequestId: approvalRequest?.id ?? null,
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return { enforcementAction, approvalRequest };
    });
  };
}

/**
 * Opens the four-eyes request and notifies, except for `REVIEW`.
 *
 * Flagging someone to look at it later does not restrict the customer, so
 * requiring four-eyes would only fill the supervisor queue with noise.
 */
async function openApproval(
  deps: RequestEnforcementActionDeps,
  input: {
    enforcementAction: EnforcementAction;
    organizationId: string;
    caseId: string;
    requesterId: string;
    now: ReturnType<Clock['now']>;
    tx: Parameters<NotificationSender['send']>[1];
  },
): Promise<ApprovalRequest | null> {
  if (input.enforcementAction.actionType === 'REVIEW') {
    return null;
  }
  const approvalRequest = ApprovalRequest.create({
    id: deps.generateApprovalRequestId(),
    enforcementActionId: input.enforcementAction.id,
    requesterId: input.requesterId,
    now: input.now,
  });
  await deps.approvalRequests.save(approvalRequest, input.tx);
  await notifyApprovers(deps, {
    organizationId: input.organizationId,
    requesterId: input.requesterId,
    caseId: input.caseId,
    enforcementActionId: input.enforcementAction.id,
    approvalRequestId: approvalRequest.id,
    actionType: input.enforcementAction.actionType,
    tx: input.tx,
  });
  return approvalRequest;
}

function assertTarget(input: RequestEnforcementActionInput): void {
  if (input.targetType.trim() === '' || input.targetId.trim() === '') {
    throw invariantViolation('targetType and targetId must not be empty', {
      targetType: input.targetType,
      targetId: input.targetId,
    });
  }
}
