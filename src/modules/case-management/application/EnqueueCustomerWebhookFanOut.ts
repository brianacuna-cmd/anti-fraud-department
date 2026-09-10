import type { Instant } from '../../../shared/time/Instant.js';
import { CustomerOutgoingEvent } from '../domain/model/aggregates/CustomerOutgoingEvent.js';
import type { TicketWebhookPayload } from '../domain/model/aggregates/CustomerOutgoingEvent.js';
import type { CustomerOutgoingEventId } from '../domain/model/value-objects/CustomerOutgoingEventId.js';
import type { WebhookTicketEventType } from '../domain/model/value-objects/WebhookTicketEventType.js';
import type { CustomerOutgoingEventRepository } from '../domain/ports/CustomerOutgoingEventRepository.js';
import type { CustomerWebhookSubscriptionRepository } from '../domain/ports/CustomerWebhookSubscriptionRepository.js';
import type { Transaction } from '../domain/ports/UnitOfWork.js';

export interface EnqueueCustomerWebhookFanOutInput {
  readonly organizationId: string;
  readonly customerId: string;
  readonly eventType: WebhookTicketEventType;
  readonly kafkaFacts: Readonly<Record<string, unknown>>;
  readonly now: Instant;
  readonly tx: Transaction;
}

export interface EnqueueCustomerWebhookFanOutDeps {
  readonly subscriptions: CustomerWebhookSubscriptionRepository;
  readonly outgoingEvents: CustomerOutgoingEventRepository;
  readonly generateCustomerOutgoingEventId: () => CustomerOutgoingEventId;
}

/**
 * Same-UoW PENDING `customer_outgoing_events` for ACTIVE catalog subscriptions
 * whose `eventTypes` include the ticket name. Does not enqueue enforcement.
 */
export function createEnqueueCustomerWebhookFanOut(deps: EnqueueCustomerWebhookFanOutDeps) {
  return async function enqueueCustomerWebhookFanOut(
    input: EnqueueCustomerWebhookFanOutInput,
  ): Promise<void> {
    const subscriptions = await deps.subscriptions.listByOrganization(
      input.organizationId,
      { active: true },
      input.tx,
    );
    const matching = subscriptions.filter((subscription) =>
      subscription.eventTypes.includes(input.eventType),
    );
    for (const subscription of matching) {
      const payload: TicketWebhookPayload = {
        event_type: input.eventType,
        organization_id: input.organizationId,
        ...input.kafkaFacts,
      };
      const event = CustomerOutgoingEvent.create({
        id: deps.generateCustomerOutgoingEventId(),
        organizationId: input.organizationId,
        customerId: input.customerId,
        enforcementActionId: null,
        webhookUrl: subscription.url,
        eventType: input.eventType,
        payload,
        now: input.now,
      });
      await deps.outgoingEvents.save(event, input.tx);
    }
  };
}
