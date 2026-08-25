/**
 * Mongo document shape for `bulk_screening_jobs`. `_id` is the aggregate's
 * branded `BulkScreeningJobId` stored as a native BSON `ObjectId`.
 * `organization_id` is an ObjectId FK. Instant fields are BSON `Date`.
 */

import type { ObjectId } from 'mongodb';

export interface BulkScreeningJobDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly file_path: string;
  readonly status: string;
  readonly total_rows: number;
  readonly processed_rows: number;
  readonly errors: string;
  readonly omitted: number;
  readonly created_by: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}
