import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { EnforcementActionRepository } from '../domain/ports/EnforcementActionRepository.js';
import type { CustomerOutgoingEventRepository } from '../domain/ports/CustomerOutgoingEventRepository.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { OrganizationFraudConfigRepository } from '../domain/ports/OrganizationFraudConfigRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { OutboxEventRepository } from '../../../shared/outbox/OutboxEventRepository.js';
import type { OutboxEventId } from '../../../shared/outbox/OutboxEventId.js';
import type { CustomerOutgoingEventId } from '../domain/model/value-objects/CustomerOutgoingEventId.js';
import type { EnforcementAction } from '../domain/model/aggregates/EnforcementAction.js';
import type { CustomerOutgoingEvent } from '../domain/model/aggregates/CustomerOutgoingEvent.js';
import type { EnforcementActionType } from '../domain/model/value-objects/EnforcementActionType.js';
import { CustomerOutgoingEvent as CustomerOutgoingEventAggregate } from '../domain/model/aggregates/CustomerOutgoingEvent.js';
import { OutboxEvent } from '../../../shared/outbox/OutboxEvent.js';
import { createEnforcementActionId } from '../domain/model/value-objects/EnforcementActionId.js';
import {
  caseNotFound,
  enforcementActionNotFound,
  forbiddenCrossTenant,
  invariantViolation,
} from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SUPERVISION_ROLES } from './authorization/policy.js';

/** Action types that require a configured outbound webhook URL before EXECUTED. */
const WEBHOOK_REQUIRED_TYPES: ReadonlySet<EnforcementActionType> = new Set([
  'BLOCK',
  'RESTRICT',
  'SUSPEND',
  'DELETE',
]);

const OUTBOX_EVENT_TYPE = 'ENFORCEMENT_EXECUTED';

export interface ExecuteEnforcementActionInput {
  readonly auth: AuthContext;
  readonly enforcementActionId: string;
}

export interface ExecuteEnforcementActionResult {
  readonly enforcementAction: EnforcementAction;
  /** Null when REVIEW executes without a configured webhook URL (no outbox row). */
  readonly outgoingEvent: CustomerOutgoingEvent | null;
}

export interface ExecuteEnforcementActionDeps {
  readonly enforcementActions: EnforcementActionRepository;
  readonly outgoingEvents: CustomerOutgoingEventRepository;
  readonly cases: CaseRepository;
  readonly fraudConfig: OrganizationFraudConfigRepository;
  readonly auditRecorder: AuditRecorder;
  readonly outbox: OutboxEventRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateCustomerOutgoingEventId: () => CustomerOutgoingEventId;
  readonly generateOutboxEventId: () => OutboxEventId;
}

/**
 * Executes an enforcement action (PR4). SUPERVISOR only.
 * Non-REVIEW requires APPROVED; REVIEW auto-executes from PENDING.
 * Same UoW: mark EXECUTED + insert customer_outgoing_events PENDING when a
 * webhook URL is available. Fail-closed for BLOCK|RESTRICT|SUSPEND|DELETE if
 * outbound_webhook_url is missing. REVIEW may EXECUTE without outbox when URL
 * is missing. Case status is never changed.
 */
export function createExecuteEnforcementActionUseCase(deps: ExecuteEnforcementActionDeps) {
  return async function executeEnforcementAction(
    input: ExecuteEnforcementActionInput,
  ): Promise<ExecuteEnforcementActionResult> {
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

      const kase = await deps.cases.findById(existing.caseId, tx);
      if (kase === null) {
        throw caseNotFound(existing.caseId);
      }

      const webhookUrl = await resolveOutboundWebhookUrl(deps, organizationId, tx);
      const requiresWebhook = WEBHOOK_REQUIRED_TYPES.has(existing.actionType);
      if (requiresWebhook && webhookUrl === null) {
        throw invariantViolation(
          'outbound_webhook_url is required to execute BLOCK|RESTRICT|SUSPEND|DELETE',
          { actionType: existing.actionType, organizationId },
        );
      }

      const now = deps.clock.now();
      const enforcementAction = existing.execute(now);

      let outgoingEvent: CustomerOutgoingEvent | null = null;
      if (webhookUrl !== null) {
        outgoingEvent = CustomerOutgoingEventAggregate.create({
          id: deps.generateCustomerOutgoingEventId(),
          organizationId: enforcementAction.organizationId,
          customerId: kase.customerId,
          enforcementActionId: enforcementAction.id,
          webhookUrl,
          eventType: OUTBOX_EVENT_TYPE,
          payload: {
            enforcement_action_id: enforcementAction.id,
            case_id: enforcementAction.caseId,
            action_type: enforcementAction.actionType,
            target_type: enforcementAction.targetType,
            target_id: enforcementAction.targetId,
            organization_id: enforcementAction.organizationId,
          },
          now,
        });
        await deps.outgoingEvents.save(outgoingEvent, tx);
      }

      await deps.enforcementActions.save(enforcementAction, tx);

      await deps.outbox.save(
        OutboxEvent.create({
          id: deps.generateOutboxEventId(),
          organizationId,
          eventType: OUTBOX_EVENT_TYPE,
          aggregateType: 'enforcement_actions',
          aggregateId: enforcementAction.id,
          payload: {
            enforcement_action_id: enforcementAction.id,
            case_id: enforcementAction.caseId,
            action_type: enforcementAction.actionType,
            target_type: enforcementAction.targetType,
            target_id: enforcementAction.targetId,
            organization_id: enforcementAction.organizationId,
            status: enforcementAction.status,
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
          action: 'EXECUTE_ENFORCEMENT_ACTION',
          resource: 'case',
          resourceId: enforcementAction.caseId,
          detail: {
            enforcementActionId: enforcementAction.id,
            actionType: enforcementAction.actionType,
            outgoingEventId: outgoingEvent?.id ?? null,
            webhookUrlPresent: webhookUrl !== null,
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return { enforcementAction, outgoingEvent };
    });
  };
}

async function resolveOutboundWebhookUrl(
  deps: ExecuteEnforcementActionDeps,
  organizationId: string,
  tx: Parameters<OrganizationFraudConfigRepository['findByOrganization']>[1],
): Promise<string | null> {
  const config = await deps.fraudConfig.findByOrganization(organizationId, tx);
  if (config === null) {
    return null;
  }
  const url = config.outboundWebhookUrl;
  if (url === null || url.trim().length === 0) {
    return null;
  }
  return url.trim();
}
