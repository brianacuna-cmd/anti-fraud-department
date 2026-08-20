import type { ObjectId } from 'mongodb';

export interface CustomerOutgoingEventPayloadDocument {
  readonly enforcement_action_id: string;
  readonly case_id: string;
  readonly action_type: string;
  readonly target_type: string;
  readonly target_id: string;
  readonly organization_id: string;
}

export interface CustomerOutgoingEventDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly customer_id: string;
  readonly enforcement_action_id: ObjectId;
  readonly webhook_url: string;
  readonly event_type: string;
  readonly payload: CustomerOutgoingEventPayloadDocument;
  readonly status: string;
  readonly response_status: number | null;
  readonly attempts: number;
  readonly last_attempt_at: Date | null;
  readonly created_at: Date;
  /**
   * Infra-only claim lease marker (not part of the domain aggregate).
   * Set by `claimPending`'s atomic `findOneAndUpdate`; dropped on every
   * `save()` (replaceOne via `toDocument`, which never sets this field),
   * releasing the lease once markSent/recordFailure persist the outcome.
   * A crashed claimer leaves it stale until LEASE_TTL_MS elapses, after
   * which the row becomes reclaimable again.
   */
  readonly claimed_at?: Date | null;
}
