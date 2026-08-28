/**
 * Mongo document shape for `sar_reports`. `_id` is the aggregate's branded
 * `SarReportId` stored as a native BSON `ObjectId`. `organization_id` is an
 * ObjectId FK; `case_id`/`aml_alert_id` are cross-module plain strings, so
 * they stay `string | null` rather than `ObjectId | null` — this module
 * never validates them as its own branded id type.
 */

import type { ObjectId } from 'mongodb';

export interface SarReportDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly case_id: string | null;
  readonly aml_alert_id: string | null;
  readonly status: string;
  readonly narrative: string;
  readonly subject_name: string | null;
  readonly suspicious_amount: number | null;
  readonly activity_start_date: Date | null;
  readonly activity_end_date: Date | null;
  readonly created_by: string;
  readonly approved_by: string | null;
  readonly approved_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}
