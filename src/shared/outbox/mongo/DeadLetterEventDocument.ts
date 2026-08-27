import type { ObjectId } from 'mongodb';

/**
 * Mongo document shape for `dead_letter_queue`. `_id` is the original
 * `OutboxEventId` as an ObjectId (D2: unique key by construction — no second
 * index needed). Instant fields are BSON `Date`.
 */
export interface DeadLetterEventDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly event_type: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly payload: Record<string, unknown>;
  readonly publish_attempts: number;
  readonly reason: string;
  readonly created_at: Date;
  readonly exhausted_at: Date;
}
