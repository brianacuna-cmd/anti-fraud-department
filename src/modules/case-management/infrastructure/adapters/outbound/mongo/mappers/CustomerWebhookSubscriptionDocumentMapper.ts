import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { CustomerWebhookSubscription } from '../../../../../domain/model/aggregates/CustomerWebhookSubscription.js';
import { createCustomerWebhookSubscriptionId } from '../../../../../domain/model/value-objects/CustomerWebhookSubscriptionId.js';
import { createWebhookTicketEventType } from '../../../../../domain/model/value-objects/WebhookTicketEventType.js';
import type { CustomerWebhookSubscriptionDocument } from '../documents/CustomerWebhookSubscriptionDocument.js';

/** snake_case (Mongo) -> camelCase (domain). Instant fields are BSON `Date`. */
export function toDomain(document: CustomerWebhookSubscriptionDocument): CustomerWebhookSubscription {
  return CustomerWebhookSubscription.rehydrate({
    id: createCustomerWebhookSubscriptionId(document._id.toString()),
    organizationId: document.organization_id.toString(),
    url: document.url,
    eventTypes: document.event_types.map(createWebhookTicketEventType),
    active: document.active,
    createdAt: fromDate(document.created_at),
    updatedAt: fromDate(document.updated_at),
  });
}

/** camelCase (domain) -> snake_case (Mongo). */
export function toDocument(subscription: CustomerWebhookSubscription): CustomerWebhookSubscriptionDocument {
  return {
    _id: new ObjectId(subscription.id),
    organization_id: new ObjectId(subscription.organizationId),
    url: subscription.url,
    event_types: [...subscription.eventTypes],
    active: subscription.active,
    created_at: toDate(subscription.createdAt),
    updated_at: toDate(subscription.updatedAt),
  };
}
