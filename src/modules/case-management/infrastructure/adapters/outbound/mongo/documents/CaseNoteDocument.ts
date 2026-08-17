/**
 * Mongo document shape for `case_notes`. Append-only — no updated_at/deleted_at.
 */

import type { ObjectId } from 'mongodb';

export interface CaseNoteDocument {
  readonly _id: ObjectId;
  readonly case_id: ObjectId;
  readonly organization_id: ObjectId;
  readonly author_id: string;
  readonly body: string;
  readonly created_at: Date;
}
