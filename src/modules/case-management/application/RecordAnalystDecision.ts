import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { AnalystDecisionRepository } from '../domain/ports/AnalystDecisionRepository.js';
import type { EnforcementActionRepository } from '../domain/ports/EnforcementActionRepository.js';
import type { ApprovalRequestRepository } from '../domain/ports/ApprovalRequestRepository.js';
import type { AssigneeDirectory } from '../domain/ports/AssigneeDirectory.js';
import type { NotificationSender } from '../domain/ports/NotificationSender.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AnalystDecisionId } from '../domain/model/value-objects/AnalystDecisionId.js';
import type { EnforcementActionId } from '../domain/model/value-objects/EnforcementActionId.js';
import type { ApprovalRequestId } from '../domain/model/value-objects/ApprovalRequestId.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import type { AnalystDecisionType } from '../domain/model/value-objects/AnalystDecisionType.js';
import type { EnforcementActionType } from '../domain/model/value-objects/EnforcementActionType.js';
import type { CaseStatus } from '../domain/model/value-objects/CaseStatus.js';
import { AnalystDecision } from '../domain/model/aggregates/AnalystDecision.js';
import { EnforcementAction } from '../domain/model/aggregates/EnforcementAction.js';
import { ApprovalRequest } from '../domain/model/aggregates/ApprovalRequest.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { createAnalystDecisionType } from '../domain/model/value-objects/AnalystDecisionType.js';
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

export interface RecordAnalystDecisionInput {
  readonly auth: AuthContext;
  readonly caseId: string;
  readonly decision: string;
  readonly confidence: number;
  readonly comment: string;
  readonly actionType?: string;
  readonly targetType?: string;
  readonly targetId?: string;
}

export interface RecordAnalystDecisionResult {
  readonly decision: AnalystDecision;
  readonly enforcementAction: EnforcementAction | null;
  /**
   * The four-eyes request opened alongside the sanction. `null` when there is
   * no sanction, or when it is `REVIEW` — flagging a customer for a closer
   * look restricts nothing, so it does not go through dual control.
   */
  readonly approvalRequest: ApprovalRequest | null;
  readonly caseStatus: CaseStatus;
}

export interface RecordAnalystDecisionDeps {
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
  readonly generateAnalystDecisionId: () => AnalystDecisionId;
  readonly generateEnforcementActionId: () => EnforcementActionId;
  readonly generateApprovalRequestId: () => ApprovalRequestId;
  readonly generateTimelineEventId: () => TimelineEventId;
}

/**
 * Records an analyst decision on a case (PR2). Role-gated to
 * ANALYST|SUPERVISOR. Persists analyst_decisions + DECISION_MADE
 * timeline + audit. On FRAUD_CONFIRMED, also creates a PENDING
 * enforcement_action from caller-supplied action/target fields.
 * Case status is intentionally never mutated.
 *
 * FOUR EYES (ENF-002). Alongside every non-REVIEW sanction, in the SAME
 * transaction, its `approval_request` is born in PENDING, and supervisors
 * are notified.
 *
 * Previously the request was created lazily inside
 * `ApproveEnforcementAction`, and that left the control with no effect: a
 * pending sanction had no request to review until someone had already
 * approved it, so the dual-control queue did not exist as a queue and nobody
 * received notice that something was waiting. The place where the measure is
 * REQUESTED is the only place where the request to review it can be born.
 */
export function createRecordAnalystDecisionUseCase(deps: RecordAnalystDecisionDeps) {
  return async function recordAnalystDecision(
    input: RecordAnalystDecisionInput,
  ): Promise<RecordAnalystDecisionResult> {
    requireOperationalRole(input.auth, CASE_WORK_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const caseId = createCaseId(input.caseId);
    const decisionType = createAnalystDecisionType(input.decision);
    const actionFields = resolveActionFields(decisionType, input);

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

      const now = deps.clock.now();
      const decision = AnalystDecision.create({
        id: deps.generateAnalystDecisionId(),
        caseId: existing.id,
        organizationId,
        decision: decisionType,
        confidence: input.confidence,
        comment: input.comment,
        createdBy: input.auth.userId,
        now,
      });
      await deps.decisions.save(decision, tx);

      let enforcementAction: EnforcementAction | null = null;
      let approvalRequest: ApprovalRequest | null = null;
      if (actionFields !== null) {
        enforcementAction = EnforcementAction.create({
          id: deps.generateEnforcementActionId(),
          caseId: existing.id,
          organizationId,
          analystDecisionId: decision.id,
          actionType: actionFields.actionType,
          targetType: actionFields.targetType,
          targetId: actionFields.targetId,
          createdBy: input.auth.userId,
          now,
        });
        await deps.enforcementActions.save(enforcementAction, tx);

        // REVIEW restricts nothing on the customer: flagging someone for a
        // closer look does not need dual control, and requiring it would only
        // fill the supervisor queue with noise.
        if (enforcementAction.actionType !== 'REVIEW') {
          approvalRequest = ApprovalRequest.create({
            id: deps.generateApprovalRequestId(),
            enforcementActionId: enforcementAction.id,
            requesterId: input.auth.userId,
            now,
          });
          await deps.approvalRequests.save(approvalRequest, tx);
          await notifyApprovers(deps, {
            organizationId,
            requesterId: input.auth.userId,
            caseId: existing.id,
            enforcementActionId: enforcementAction.id,
            approvalRequestId: approvalRequest.id,
            actionType: enforcementAction.actionType,
            tx,
          });
        }
      }

      const timelineEvent = CaseTimelineEvent.create({
        id: deps.generateTimelineEventId(),
        caseId: existing.id,
        eventType: 'DECISION_MADE',
        previousValue: null,
        newValue: decisionType,
        createdBy: input.auth.userId,
        createdAt: now,
      });
      await deps.timelineRecorder.record(timelineEvent, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'RECORD_ANALYST_DECISION',
          resource: 'case',
          resourceId: existing.id,
          detail: {
            decision: decisionType,
            confidence: input.confidence,
            comment: input.comment,
            enforcementActionId: enforcementAction?.id ?? null,
            approvalRequestId: approvalRequest?.id ?? null,
            actionType: enforcementAction?.actionType ?? null,
            targetType: enforcementAction?.targetType ?? null,
            targetId: enforcementAction?.targetId ?? null,
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return {
        decision,
        enforcementAction,
        approvalRequest,
        caseStatus: existing.status,
      };
    });
  };
}

interface ResolvedActionFields {
  readonly actionType: EnforcementActionType;
  readonly targetType: string;
  readonly targetId: string;
}

function resolveActionFields(
  decisionType: AnalystDecisionType,
  input: RecordAnalystDecisionInput,
): ResolvedActionFields | null {
  if (decisionType !== 'FRAUD_CONFIRMED') {
    return null;
  }
  if (
    input.actionType === undefined ||
    input.targetType === undefined ||
    input.targetId === undefined
  ) {
    throw invariantViolation(
      'FRAUD_CONFIRMED requires actionType, targetType, and targetId',
      {
        actionType: input.actionType ?? null,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
      },
    );
  }
  return {
    actionType: createEnforcementActionType(input.actionType),
    targetType: input.targetType,
    targetId: input.targetId,
  };
}
