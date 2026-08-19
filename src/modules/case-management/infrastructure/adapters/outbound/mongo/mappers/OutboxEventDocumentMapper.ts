import { ObjectId } from 'mongodb';
import { fromDate, toDate, type Instant } from '../../../../../../../shared/time/Instant.js';
import { OutboxEvent } from '../../../../../domain/model/aggregates/OutboxEvent.js';
import { createOutboxEventId } from '../../../../../domain/model/value-objects/OutboxEventId.js';
import { createOutboxEventStatus } from '../../../../../domain/model/value-objects/OutboxEventStatus.js';
import type { OutboxEventDocument } from '../documents/OutboxEventDocument.js';

const instantToDate = (value: Instant | null): Date | null => (value === null ? null : toDate(value));
const dateToInstant = (value: Date | null): Instant | null => (value === null ? null : fromDate(value));

/** camelCase (domain) -> snake_case (Mongo). Instant fields become BSON `Date`. */
export function toDocument(event: OutboxEvent): OutboxEventDocument {
  return {
    _id: new ObjectId(event.id),
    organization_id: new ObjectId(event.organizationId),
    event_type: event.eventType,
    aggregate_type: event.aggregateType,
    aggregate_id: event.aggregateId,
    payload: event.payload,
    status: event.status,
    publish_attempts: event.publishAttempts,
    last_error: event.lastError,
    published_at: instantToDate(event.publishedAt),
    next_retry_at: instantToDate(event.nextRetryAt),
    locked_until: instantToDate(event.lockedUntil),
    created_at: toDate(event.createdAt),
  };
}

/** snake_case (Mongo) -> camelCase (domain). */
export function toDomain(document: OutboxEventDocument): OutboxEvent {
  return OutboxEvent.rehydrate({
    id: createOutboxEventId(document._id.toString()),
    organizationId: document.organization_id.toString(),
    eventType: document.event_type,
    aggregateType: document.aggregate_type,
    aggregateId: document.aggregate_id,
    payload: document.payload,
    status: createOutboxEventStatus(document.status),
    publishAttempts: document.publish_attempts,
    lastError: document.last_error,
    publishedAt: dateToInstant(document.published_at),
    nextRetryAt: dateToInstant(document.next_retry_at),
    lockedUntil: dateToInstant(document.locked_until),
    createdAt: fromDate(document.created_at),
  });
}
