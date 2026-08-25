/**
 * Mongo document shape for `aml_alerts`. `_id` is the aggregate's branded
 * `AmlAlertId` stored as a native BSON `ObjectId`. `organization_id` is an
 * ObjectId FK. `customer_id` is an OPAQUE EXTERNAL STRING (e.g. Stripe
 * `cus_…`, Bridge ids) — never coerced to ObjectId, matching how
 * case-management stores it. `matched_entry` is an embedded snapshot of
 * the watchlist entry as it existed at match time (design: "matched_entry
 * embedded"). Instant fields are BSON `Date`.
 */

import type { ObjectId } from 'mongodb';

export interface AmlAlertMatchedEntryDocument {
  readonly entry_id: ObjectId;
  readonly watchlist_id: ObjectId;
  readonly name: string;
  readonly document: string | null;
  readonly risk_level: string | null;
  readonly match_field: string;
  readonly algorithm: string;
}

export interface AmlAlertDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly customer_id: string;
  readonly alert_type: string;
  readonly suspected_entity: string;
  readonly confidence: number;
  readonly detection_source: string;
  readonly status: string;
  readonly severity: string;
  readonly matched_entry: AmlAlertMatchedEntryDocument;
  readonly case_id: ObjectId | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}
