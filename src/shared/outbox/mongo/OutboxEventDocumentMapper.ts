import { ObjectId } from 'mongodb';
import { toDate, type Instant } from '../../time/Instant.js';
import type { OutboxEvent } from '../OutboxEvent.js';
import type { OutboxEventDocument } from './OutboxEventDocument.js';

const instantToDate = (value: Instant | null): Date | null => (value === null ? null : toDate(value));

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
