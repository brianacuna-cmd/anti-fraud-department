/**
 * Mongo document shape for `case_notes`. Append-only content; `deleted_at`
 * supports logical (soft) deletion of erroneous notes without dropping the row.
 */

import type { ObjectId } from 'mongodb';

export interface CaseNoteDocument {
  readonly _id: ObjectId;
  readonly case_id: ObjectId;
  readonly organization_id: ObjectId;
  readonly author_id: string;
  readonly body: string;
  readonly created_at: Date;
  readonly deleted_at: Date | null;
}
