/**
 * Mongo document shape for `case_timeline`. Append-only — no updated_at/deleted_at.
 */

import type { ObjectId } from 'mongodb';

export interface CaseTimelineDocument {
  readonly _id: ObjectId;
  readonly case_id: ObjectId;
  readonly event_type: string;
  readonly previous_value: string | null;
  readonly new_value: string | null;
  readonly created_by: string | null;
  readonly created_at: Date;
}
