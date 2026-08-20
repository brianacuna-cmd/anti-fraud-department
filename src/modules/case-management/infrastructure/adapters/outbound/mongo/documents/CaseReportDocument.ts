/**
 * Mongo document shape for `case_reports`. `snapshot` is the frozen case graph
 * stored as an embedded BSON object. Append-only — no updated_at/deleted_at.
 */

import type { ObjectId } from 'mongodb';

export interface CaseReportDocument {
  readonly _id: ObjectId;
  readonly case_id: ObjectId;
  readonly organization_id: ObjectId;
  readonly generated_by: string;
  readonly snapshot: Readonly<Record<string, unknown>>;
  readonly created_at: Date;
}
