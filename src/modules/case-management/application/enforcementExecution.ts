import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { EnforcementActionRepository } from '../domain/ports/EnforcementActionRepository.js';
import type { CustomerOutgoingEventRepository } from '../domain/ports/CustomerOutgoingEventRepository.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { OrganizationFraudConfigRepository } from '../domain/ports/OrganizationFraudConfigRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { Transaction } from '../domain/ports/UnitOfWork.js';
import type { OutboxEventRepository } from '../../../shared/outbox/OutboxEventRepository.js';
import type { OutboxEventId } from '../../../shared/outbox/OutboxEventId.js';
import type { CustomerOutgoingEventId } from '../domain/model/value-objects/CustomerOutgoingEventId.js';
import type { EnforcementAction } from '../domain/model/aggregates/EnforcementAction.js';
import type { CustomerOutgoingEvent } from '../domain/model/aggregates/CustomerOutgoingEvent.js';
import type { EnforcementActionType } from '../domain/model/value-objects/EnforcementActionType.js';
import { CustomerOutgoingEvent as CustomerOutgoingEventAggregate } from '../domain/model/aggregates/CustomerOutgoingEvent.js';
import { OutboxEvent } from '../../../shared/outbox/OutboxEvent.js';
import { caseNotFound, invariantViolation } from '../domain/errors/CaseManagementError.js';

/** Action types that require a configured outbound webhook URL before EXECUTED. */
const WEBHOOK_REQUIRED_TYPES: ReadonlySet<EnforcementActionType> = new Set([
  'BLOCK',
  'RESTRICT',
  'SUSPEND',
  'DELETE',
]);

const OUTBOX_EVENT_TYPE = 'ENFORCEMENT_EXECUTED';

export interface EnforcementExecutionDeps {
  readonly enforcementActions: EnforcementActionRepository;
  readonly outgoingEvents: CustomerOutgoingEventRepository;
  readonly cases: CaseRepository;
  readonly fraudConfig: OrganizationFraudConfigRepository;
  readonly auditRecorder: AuditRecorder;
  readonly outbox: OutboxEventRepository;
  readonly clock: Clock;
  readonly generateCustomerOutgoingEventId: () => CustomerOutgoingEventId;
  readonly generateOutboxEventId: () => OutboxEventId;
}

export interface EnforcementExecutionResult {
  readonly enforcementAction: EnforcementAction;
  /** Null when the action executes without a configured webhook URL (no outbox row). */
  readonly outgoingEvent: CustomerOutgoingEvent | null;
}

/**
 * Whether the tenant can deliver this action right now. BLOCK, RESTRICT,
 * SUSPEND and DELETE fail closed without an outbound webhook: marking them
 * EXECUTED would claim a sanction nobody delivered.
 */
export async function canExecuteNow(
  deps: Pick<EnforcementExecutionDeps, 'fraudConfig'>,
  action: EnforcementAction,
  tx: Transaction | undefined,
): Promise<boolean> {
  if (!WEBHOOK_REQUIRED_TYPES.has(action.actionType)) {
    return true;
  }
  return (await resolveOutboundWebhookUrl(deps, action.organizationId, tx)) !== null;
}

/**
 * Executes an already-loaded, tenant-checked action inside the caller's
 * transaction: mark EXECUTED, queue the customer webhook when a URL is
 * configured, emit ENFORCEMENT_EXECUTED and audit. Shared by the execute
 * route and by approval, which executes the measure it authorizes.
 */
export async function executeEnforcementWithin(
  deps: EnforcementExecutionDeps,
  existing: EnforcementAction,
  auth: AuthContext,
  tx: Transaction | undefined,
): Promise<EnforcementExecutionResult> {
  const organizationId = existing.organizationId;
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
      actorType: auth.actorType,
      actorId: auth.userId,
      action: 'EXECUTE_ENFORCEMENT_ACTION',
      resource: 'case',
      resourceId: enforcementAction.caseId,
      detail: {
        enforcementActionId: enforcementAction.id,
        actionType: enforcementAction.actionType,
        outgoingEventId: outgoingEvent?.id ?? null,
        webhookUrlPresent: webhookUrl !== null,
      },
      ipAddress: auth.ipAddress,
    },
    tx,
  );

  return { enforcementAction, outgoingEvent };
}

async function resolveOutboundWebhookUrl(
  deps: Pick<EnforcementExecutionDeps, 'fraudConfig'>,
  organizationId: string,
  tx: Transaction | undefined,
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
