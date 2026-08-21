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
  /** Dictamen que motiva la sanción. Obligatorio: ver la nota del caso de uso. */
  readonly analystDecisionId: string;
  readonly actionType: string;
  readonly targetType: string;
  readonly targetId: string;
}

export interface RequestEnforcementActionResult {
  readonly enforcementAction: EnforcementAction;
  /** `null` solo para `REVIEW`, que no restringe nada y no pasa por doble firma. */
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
 * ENF-001 — solicitud suelta de una medida cautelar.
 *
 * POST /cases/:caseId/enforcement-actions
 *
 * Hasta ahora una sanción solo podía nacer como efecto de
 * `RecordAnalystDecision`, lo que obligaba a volver a dictaminar el caso para
 * pedir una segunda medida —bloquear la wallet y, además, suspender al
 * cliente— y dejaba en el expediente dos dictámenes donde el analista solo
 * tomó una decisión.
 *
 * Lo que NO se relaja es el vínculo con el dictamen: `EnforcementAction`
 * exige `analystDecisionId` y aquí se sigue exigiendo. Una sanción sin
 * veredicto registrado es una restricción sobre el dinero de alguien que
 * nadie firmó, y ese es justamente el expediente que no se puede defender
 * ante un regulador. El dictamen se valida contra el caso: tiene que existir,
 * ser de este expediente y de este inquilino.
 *
 * Los cuatro ojos (ENF-002) se disparan igual que en el dictamen y en la
 * misma transacción, reutilizando `notifyApprovers`: las dos puertas por las
 * que nace una sanción abren la misma cola.
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
 * Abre la solicitud de doble firma y avisa, salvo para `REVIEW`.
 *
 * Marcar a alguien para mirarlo con calma no restringe nada al cliente, así
 * que exigir doble firma solo llenaría de ruido la cola del supervisor.
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
