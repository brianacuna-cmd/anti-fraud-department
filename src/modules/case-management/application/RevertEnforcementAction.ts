import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { EnforcementActionRepository } from '../domain/ports/EnforcementActionRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { OutboxEventRepository } from '../../../shared/outbox/OutboxEventRepository.js';
import type { OutboxEventId } from '../../../shared/outbox/OutboxEventId.js';
import type { EnforcementAction } from '../domain/model/aggregates/EnforcementAction.js';
import { OutboxEvent } from '../../../shared/outbox/OutboxEvent.js';
import { createEnforcementActionId } from '../domain/model/value-objects/EnforcementActionId.js';
import { enforcementActionNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SUPERVISION_ROLES } from './authorization/policy.js';

const OUTBOX_EVENT_TYPE = 'ENFORCEMENT_REVERTED';

export interface RevertEnforcementActionInput {
  readonly auth: AuthContext;
  readonly enforcementActionId: string;
}

export interface RevertEnforcementActionDeps {
  readonly enforcementActions: EnforcementActionRepository;
  readonly auditRecorder: AuditRecorder;
  readonly outbox: OutboxEventRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateOutboxEventId: () => OutboxEventId;
}

/**
 * Reverses a previously executed sanction (EXECUTED -> REVERTED). SUPERVISOR only. Reverting from any status other than EXECUTED throws
 * `invalidTransition` (422). Within ONE transaction: mark REVERTED, emit an
 * ENFORCEMENT_REVERTED `outbox_events` row, and audit.
 * Scope: enforcement_actions, outbox_events, audit_logs.
 */
export function createRevertEnforcementActionUseCase(deps: RevertEnforcementActionDeps) {
  return async function revertEnforcementAction(
    input: RevertEnforcementActionInput,
  ): Promise<EnforcementAction> {
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

      const now = deps.clock.now();
      const reverted = existing.revert(now);
      await deps.enforcementActions.save(reverted, tx);

      await deps.outbox.save(
        OutboxEvent.create({
          id: deps.generateOutboxEventId(),
          organizationId,
          eventType: OUTBOX_EVENT_TYPE,
          aggregateType: 'enforcement_actions',
          aggregateId: reverted.id,
          payload: {
            enforcement_action_id: reverted.id,
            case_id: reverted.caseId,
            action_type: reverted.actionType,
            target_type: reverted.targetType,
            target_id: reverted.targetId,
            organization_id: reverted.organizationId,
            status: reverted.status,
          },
          now,
        }),
        tx,
      );

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'REVERT_ENFORCEMENT_ACTION',
          resource: 'case',
          resourceId: reverted.caseId,
          detail: {
            enforcementActionId: reverted.id,
            actionType: reverted.actionType,
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return reverted;
    });
  };
}
