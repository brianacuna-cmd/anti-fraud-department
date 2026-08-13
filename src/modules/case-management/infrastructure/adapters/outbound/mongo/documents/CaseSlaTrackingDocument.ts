/**
 * Mongo document shape for `case_sla_tracking`. Instant fields are BSON `Date`;
 * range queries and indexes use `due_date` directly (no ISO-string mirror).
 */

import type { ObjectId } from 'mongodb';

export interface CaseSlaTrackingDocument {
  readonly _id: ObjectId;
  readonly case_id: ObjectId;
  readonly due_date: Date;
  readonly status: string;
  readonly notification_sent: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
}
