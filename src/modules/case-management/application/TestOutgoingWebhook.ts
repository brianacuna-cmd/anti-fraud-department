import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import { CustomerOutgoingEvent } from '../domain/model/aggregates/CustomerOutgoingEvent.js';
import type { WebhookTestPayload } from '../domain/model/aggregates/CustomerOutgoingEvent.js';
import type { CustomerOutgoingEventId } from '../domain/model/value-objects/CustomerOutgoingEventId.js';
import { outboundWebhookUrlNotSet } from '../domain/errors/CaseManagementError.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { CustomerOutgoingEventRepository } from '../domain/ports/CustomerOutgoingEventRepository.js';
import type { CustomerWebhookSubscriptionRepository } from '../domain/ports/CustomerWebhookSubscriptionRepository.js';
import type { OrganizationFraudConfigRepository } from '../domain/ports/OrganizationFraudConfigRepository.js';
import type { OutgoingWebhookClient } from '../domain/ports/OutgoingWebhookClient.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SUPERVISION_ROLES } from './authorization/policy.js';

const WEBHOOK_TEST = 'WEBHOOK_TEST' as const;

export interface TestOutgoingWebhookInput {
  readonly auth: AuthContext;
}

export interface TestOutgoingWebhookDelivery {
  readonly url: string;
  readonly statusCode: number;
  readonly latencyMs: number;
  readonly ok: boolean;
  readonly eventId: string;
}

export interface TestOutgoingWebhookResult {
  readonly deliveries: readonly TestOutgoingWebhookDelivery[];
}

export interface TestOutgoingWebhookDeps {
  readonly fraudConfig: OrganizationFraudConfigRepository;
  readonly subscriptions: CustomerWebhookSubscriptionRepository;
  readonly webhookClient: OutgoingWebhookClient;
  readonly outgoingEvents: CustomerOutgoingEventRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateCustomerOutgoingEventId: () => CustomerOutgoingEventId;
}

function uniqueActiveUrls(urls: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const url of urls) {
    if (!seen.has(url)) {
      seen.add(url);
      unique.push(url);
    }
  }
  return unique;
}

/**
 * SUPERVISOR one-shot probe of unique ACTIVE subscription URLs, else the org
 * outbound URL. HTTP I/O is outside the Mongo transaction; persist + audit
 * run inside `withTransaction` after each `post()`.
 */
export function createTestOutgoingWebhookUseCase(deps: TestOutgoingWebhookDeps) {
  return async function testOutgoingWebhook(
    input: TestOutgoingWebhookInput,
  ): Promise<TestOutgoingWebhookResult> {
    requireOperationalRole(input.auth, SUPERVISION_ROLES);
    const organizationId = requireTenantContext(input.auth);

    const config = await deps.fraudConfig.findByOrganization(organizationId);
    const subscriptions = await deps.subscriptions.listByOrganization(organizationId, { active: true });
    const urls = uniqueActiveUrls(subscriptions.map((subscription) => subscription.url));
    if (urls.length === 0) {
      const orgUrl = config?.outboundWebhookUrl?.trim() ?? '';
      if (orgUrl.length > 0) {
        urls.push(orgUrl);
      }
    }
    if (urls.length === 0) {
      throw outboundWebhookUrlNotSet(organizationId);
    }

    const now = deps.clock.now();
    const previous =
      config?.outboundWebhookPreviousSecret &&
      config.outboundWebhookSecretGraceExpiresAt !== null &&
      now < config.outboundWebhookSecretGraceExpiresAt
        ? config.outboundWebhookPreviousSecret
        : null;

    const deliveries: TestOutgoingWebhookDelivery[] = [];

    for (const url of urls) {
      const eventId = deps.generateCustomerOutgoingEventId();
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
          ...(previous === null ? {} : { previousSecret: previous }),
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

      deliveries.push({ url, statusCode, latencyMs, ok, eventId });
    }

    return { deliveries };
  };
}
