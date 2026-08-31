import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { CustomerOutgoingEvent } from '../../../../../domain/model/aggregates/CustomerOutgoingEvent.js';
import { createCustomerOutgoingEventId } from '../../../../../domain/model/value-objects/CustomerOutgoingEventId.js';
import { createCustomerOutgoingEventStatus } from '../../../../../domain/model/value-objects/CustomerOutgoingEventStatus.js';
import { createEnforcementActionId } from '../../../../../domain/model/value-objects/EnforcementActionId.js';
import type { CustomerOutgoingEventDocument } from '../documents/CustomerOutgoingEventDocument.js';

export function toDocument(event: CustomerOutgoingEvent): CustomerOutgoingEventDocument {
  return {
    _id: new ObjectId(event.id),
    organization_id: new ObjectId(event.organizationId),
    customer_id: event.customerId,
    enforcement_action_id:
      event.enforcementActionId === null ? null : new ObjectId(event.enforcementActionId),
    webhook_url: event.webhookUrl,
    event_type: event.eventType,
    payload: { ...event.payload },
    status: event.status,
    response_status: event.responseStatus,
    attempts: event.attempts,
    last_attempt_at: event.lastAttemptAt === null ? null : toDate(event.lastAttemptAt),
    created_at: toDate(event.createdAt),
    latency_ms: event.latencyMs,
  };
}

export function toDomain(document: CustomerOutgoingEventDocument): CustomerOutgoingEvent {
  return CustomerOutgoingEvent.rehydrate({
    id: createCustomerOutgoingEventId(document._id.toString()),
    organizationId: document.organization_id.toString(),
    customerId: document.customer_id,
    enforcementActionId:
      document.enforcement_action_id === null
        ? null
        : createEnforcementActionId(document.enforcement_action_id.toString()),
    webhookUrl: document.webhook_url,
    eventType: document.event_type,
    payload: { ...document.payload },
    status: createCustomerOutgoingEventStatus(document.status),
    responseStatus: document.response_status,
    attempts: document.attempts,
    lastAttemptAt: document.last_attempt_at === null ? null : fromDate(document.last_attempt_at),
    createdAt: fromDate(document.created_at),
    latencyMs: document.latency_ms ?? null,
  });
}
