/**
 * Mongo document shape for `investigations` (1:N per case).
 */

import type { ObjectId } from 'mongodb';

export interface InvestigationDocument {
  readonly _id: ObjectId;
  readonly case_id: ObjectId;
  readonly organization_id: ObjectId;
  readonly subject_type: string;
  readonly subject_id: string;
  readonly status: string;
  readonly findings: string | null;
  readonly opened_by: string;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly closed_at: Date | null;
}
