import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../time/Instant.js';
import { DeadLetterEvent } from '../DeadLetterEvent.js';
import { createOutboxEventId } from '../OutboxEventId.js';
import type { DeadLetterEventDocument } from './DeadLetterEventDocument.js';

/** camelCase (domain) -> snake_case (Mongo). Instant fields become BSON `Date`. */
export function toDocument(event: DeadLetterEvent): DeadLetterEventDocument {
  return {
    _id: new ObjectId(event.id),
    organization_id: new ObjectId(event.organizationId),
    event_type: event.eventType,
    aggregate_type: event.aggregateType,
    aggregate_id: event.aggregateId,
    payload: event.payload,
    publish_attempts: event.publishAttempts,
    reason: event.reason,
    created_at: toDate(event.createdAt),
    exhausted_at: toDate(event.exhaustedAt),
  };
}

/** snake_case (Mongo) -> camelCase (domain). */
export function toDomain(document: DeadLetterEventDocument): DeadLetterEvent {
  return DeadLetterEvent.rehydrate({
    id: createOutboxEventId(document._id.toString()),
    organizationId: document.organization_id.toString(),
    eventType: document.event_type,
    aggregateType: document.aggregate_type,
    aggregateId: document.aggregate_id,
    payload: document.payload,
    publishAttempts: document.publish_attempts,
    reason: document.reason,
    createdAt: fromDate(document.created_at),
    exhaustedAt: fromDate(document.exhausted_at),
  });
}
