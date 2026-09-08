import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import { CustomerOutgoingEvent } from '../domain/model/aggregates/CustomerOutgoingEvent.js';
import type { WebhookTestPayload } from '../domain/model/aggregates/CustomerOutgoingEvent.js';
import type { CustomerOutgoingEventId } from '../domain/model/value-objects/CustomerOutgoingEventId.js';
import { outboundWebhookUrlNotSet } from '../domain/errors/CaseManagementError.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { CustomerOutgoingEventRepository } from '../domain/ports/CustomerOutgoingEventRepository.js';
import type { OrganizationFraudConfigRepository } from '../domain/ports/OrganizationFraudConfigRepository.js';
import type { OutgoingWebhookClient } from '../domain/ports/OutgoingWebhookClient.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SUPERVISION_ROLES } from './authorization/policy.js';

const WEBHOOK_TEST = 'WEBHOOK_TEST' as const;

export interface TestOutgoingWebhookInput {
  readonly auth: AuthContext;
}

export interface TestOutgoingWebhookResult {
  readonly statusCode: number;
  readonly latencyMs: number;
  readonly ok: boolean;
  readonly eventId: string;
}

export interface TestOutgoingWebhookDeps {
  readonly fraudConfig: OrganizationFraudConfigRepository;
  readonly webhookClient: OutgoingWebhookClient;
  readonly outgoingEvents: CustomerOutgoingEventRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateCustomerOutgoingEventId: () => CustomerOutgoingEventId;
}

/**
 * SUPERVISOR one-shot probe of the tenant outbound URL. HTTP I/O is outside
 * the Mongo transaction; persist + audit run inside `withTransaction` after
 * `post()`. Remote 5xx and thrown post() still return our 200 envelope.
 */
export function createTestOutgoingWebhookUseCase(deps: TestOutgoingWebhookDeps) {
  return async function testOutgoingWebhook(
    input: TestOutgoingWebhookInput,
  ): Promise<TestOutgoingWebhookResult> {
    requireOperationalRole(input.auth, SUPERVISION_ROLES);
    const organizationId = requireTenantContext(input.auth);

    const config = await deps.fraudConfig.findByOrganization(organizationId);
    const url = config?.outboundWebhookUrl?.trim() ?? '';
    if (url.length === 0) {
      throw outboundWebhookUrlNotSet(organizationId);
    }

    const eventId = deps.generateCustomerOutgoingEventId();
    const now = deps.clock.now();
    const payload: WebhookTestPayload = {
      event_type: WEBHOOK_TEST,
      organization_id: organizationId,
      event_id: eventId,
      requested_at: now,
    };

    let statusCode = 0;
    let ok = false;
    const started = performance.now();
    try {
      const result = await deps.webhookClient.post({
        url,
        payload: { ...payload },
        secret: config?.outboundWebhookSecret,
      });
      statusCode = result.statusCode;
      ok = result.ok;
    } catch {
      statusCode = 0;
      ok = false;
    }
    const latencyMs = Math.round(performance.now() - started);

    const event = CustomerOutgoingEvent.createRecordedDelivery({
      id: eventId,
      organizationId,
      customerId: WEBHOOK_TEST,
      webhookUrl: url,
      eventType: WEBHOOK_TEST,
      payload,
      status: ok ? 'SENT' : 'FAILED',
      responseStatus: statusCode,
      latencyMs,
      now,
    });

    await deps.unitOfWork.withTransaction(async (tx) => {
      await deps.outgoingEvents.save(event, tx);
      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: WEBHOOK_TEST,
          resource: 'outgoing_webhook',
          resourceId: eventId,
          detail: { statusCode, latencyMs, ok },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );
    });

    return { statusCode, latencyMs, ok, eventId };
  };
}
