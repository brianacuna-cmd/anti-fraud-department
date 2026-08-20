import type { ObjectId } from 'mongodb';

/**
 * Mongo document shape for `outbox_events` (transactional outbox). `_id` is the
 * branded OutboxEventId, `organization_id` an ObjectId, Instant fields BSON `Date`.
 */
export interface OutboxEventDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly event_type: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly payload: Record<string, unknown>;
  readonly status: string;
  readonly publish_attempts: number;
  readonly last_error: string | null;
  readonly published_at: Date | null;
  readonly next_retry_at: Date | null;
  readonly locked_until: Date | null;
  readonly created_at: Date;
}
