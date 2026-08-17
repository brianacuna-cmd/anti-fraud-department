/**
 * Mongo document shape for `resolutions`. Append-only — no updated_at/deleted_at.
 */

import type { ObjectId } from 'mongodb';

export interface ResolutionDocument {
  readonly _id: ObjectId;
  readonly case_id: ObjectId;
  readonly organization_id: ObjectId;
  readonly closure_type: string;
  readonly reason: string;
  readonly resolved_by: string;
  readonly created_at: Date;
}
