/**
 * Mongo document shape for an AML expediente `case_timeline` row.
 * Same collection and column names as case-management's CaseTimelineDocument
 * so a later reader can load these rows by the alert id.
 */

import type { ObjectId } from 'mongodb';

export interface AmlExpedienteTimelineDocument {
  readonly _id: ObjectId;
  readonly case_id: ObjectId;
  readonly event_type: string;
  readonly previous_value: string | null;
  readonly new_value: string | null;
  readonly created_by: string | null;
  readonly created_at: Date;
}
