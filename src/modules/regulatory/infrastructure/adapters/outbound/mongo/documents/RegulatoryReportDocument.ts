/** Forma Mongo de `regulatory_reports`. `_id` y `organization_id` son ObjectId. */

import type { ObjectId } from 'mongodb';

/** Las cifras congeladas, tal cual se guardan. */
export interface RegulatoryFiguresDocument {
  readonly cases_opened: number;
  readonly cases_resolved: number;
  readonly fraud_confirmed: number;
  readonly false_positives: number;
  readonly sla_breached: number;
  readonly enforcement_executed: number;
  readonly enforcement_reverted: number;
  readonly sars_filed: number;
  readonly suspicious_amount_declared: number | null;
  /** Siempre null: ver `RegulatoryFigures.blockedAmount`. */
  readonly blocked_amount: null;
}

export interface RegulatoryReportDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly period_start: Date;
  readonly period_end: Date;
  readonly status: string;
  readonly figures: RegulatoryFiguresDocument;
  readonly generated_by: string;
  readonly generated_at: Date;
  readonly issued_by: string | null;
  readonly issued_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}
