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
  readonly findings_data: Record<string, unknown> | null;
  readonly exploration_depth: number | null;
  readonly opened_by: string;
  readonly linked_case_ids: ObjectId[];
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly closed_at: Date | null;
}
