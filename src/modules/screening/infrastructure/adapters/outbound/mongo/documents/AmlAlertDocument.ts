/**
 * Mongo document shape for `aml_alerts`. `_id` is the aggregate's branded
 * `AmlAlertId` stored as a native BSON `ObjectId`. `organization_id` is an
 * ObjectId FK. `customer_id` is an OPAQUE EXTERNAL STRING (e.g. Stripe
 * `cus_…`, Bridge ids) — never coerced to ObjectId, matching how
 * case-management stores it. `matched_entry` is an embedded snapshot of
 * the watchlist entry as it existed at match time (design: "matched_entry
 * embedded"). Instant fields are BSON `Date`.
 */

import type { ObjectId } from 'mongodb';

export interface AmlAlertMatchedEntryDocument {
  readonly entry_id: ObjectId;
  readonly watchlist_id: ObjectId;
  readonly nombre: string;
  readonly documento: string | null;
  readonly nivel_riesgo: string | null;
  readonly match_field: string;
  readonly algorithm: string;
}

export interface AmlAlertDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly customer_id: string;
  readonly tipo_alerta: string;
  readonly entidad_sospechosa: string;
  readonly confianza: number;
  readonly fuente_deteccion: string;
  readonly estado: string;
  readonly severidad: string;
  readonly matched_entry: AmlAlertMatchedEntryDocument;
  readonly case_id: ObjectId | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}
