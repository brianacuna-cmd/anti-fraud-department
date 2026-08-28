/**
 * Mongo document shape for `sar_reports`. `_id` is the aggregate's branded
 * `SarReportId` stored as a native BSON `ObjectId`. `organization_id` is an
 * ObjectId FK; `case_id`/`aml_alert_id` are cross-module plain strings, so
 * they stay `string | null` rather than `ObjectId | null` — this module
 * never validates them as its own branded id type.
 */

import type { ObjectId } from 'mongodb';

/** Embedded address; `null` on the document when the subject's is unknown. */
export interface PostalAddressDocument {
  readonly street: string;
  readonly city: string;
  readonly state: string | null;
  readonly postal_code: string;
  readonly country: string;
}

export interface SarReportDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly case_id: string | null;
  readonly aml_alert_id: string | null;
  readonly status: string;
  readonly narrative: string;
  readonly subject_name: string | null;
  readonly subject_address: PostalAddressDocument | null;
  readonly subject_tin: string | null;
  readonly subject_tin_type: string | null;
  readonly subject_birth_date: Date | null;
  readonly suspicious_amount: number | null;
  readonly activity_categories: readonly string[];
  readonly activity_start_date: Date | null;
  readonly activity_end_date: Date | null;
  readonly created_by: string;
  readonly approved_by: string | null;
  readonly approved_at: Date | null;
  readonly bsa_identifier: string | null;
  readonly filed_at: Date | null;
  readonly filed_by: string | null;
  readonly acknowledgement_reference: string | null;
  readonly filing_rejection_reason: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}
