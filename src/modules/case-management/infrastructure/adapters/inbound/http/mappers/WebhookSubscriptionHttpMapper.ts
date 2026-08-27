import { toDate } from '../../../../../../../shared/time/Instant.js';
import type { CustomerWebhookSubscription } from '../../../../../domain/model/aggregates/CustomerWebhookSubscription.js';

export interface WebhookSubscriptionResponseDto {
  readonly id: string;
  readonly organizationId: string;
  readonly url: string;
  readonly eventTypes: readonly string[];
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Domain → HTTP camelCase DTO with ISO timestamps. */
export function toWebhookSubscriptionResponse(
  subscription: CustomerWebhookSubscription,
): WebhookSubscriptionResponseDto {
  return {
    id: String(subscription.id),
    organizationId: subscription.organizationId,
    url: subscription.url,
    eventTypes: [...subscription.eventTypes],
    active: subscription.active,
    createdAt: toDate(subscription.createdAt).toISOString(),
    updatedAt: toDate(subscription.updatedAt).toISOString(),
  };
}
