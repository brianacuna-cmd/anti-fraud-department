import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { FraudDepartmentMetrics } from '../../../../../domain/model/aggregates/FraudDepartmentMetrics.js';
import type { FraudDepartmentMetricsDocument } from '../documents/FraudDepartmentMetricsDocument.js';

export interface UpsertFields {
  readonly key: { readonly organization_id: ObjectId; readonly fecha: string };
  readonly set: {
    readonly casos_abiertos: number;
    readonly casos_cerrados: number;
    readonly sla_compliance_pct: number | null;
    readonly precision_modelo: number | null;
    readonly false_positive_rate: number | null;
  };
  readonly setOnInsert: {
    readonly _id: ObjectId;
    readonly organization_id: ObjectId;
    readonly fecha: string;
    readonly created_at: Date;
  };
}

/**
 * Splits a desired post-state into the `$set`/`$setOnInsert` fragments the
 * repository's atomic upsert needs, keyed on the natural key
 * `(organization_id, fecha)`. `_id`/`created_at` are written only via
 * `$setOnInsert` — a re-run for the same day never mints a new `_id` or
 * overwrites the original `created_at`.
 */
export function toUpsertFields(metrics: FraudDepartmentMetrics): UpsertFields {
  const organizationId = new ObjectId(metrics.organizationId);
  return {
    key: { organization_id: organizationId, fecha: metrics.fecha },
    set: {
      casos_abiertos: metrics.casosAbiertos,
      casos_cerrados: metrics.casosCerrados,
      sla_compliance_pct: metrics.slaCompliancePct,
      precision_modelo: metrics.precisionModelo,
      false_positive_rate: metrics.falsePositiveRate,
    },
    setOnInsert: {
      _id: new ObjectId(),
      organization_id: organizationId,
      fecha: metrics.fecha,
      created_at: toDate(metrics.createdAt),
    },
  };
}

/** snake_case (Mongo) -> camelCase (domain). */
export function toDomain(document: FraudDepartmentMetricsDocument): FraudDepartmentMetrics {
  return FraudDepartmentMetrics.rehydrate({
    organizationId: document.organization_id.toString(),
    fecha: document.fecha,
    casosAbiertos: document.casos_abiertos,
    casosCerrados: document.casos_cerrados,
    slaCompliancePct: document.sla_compliance_pct,
    precisionModelo: document.precision_modelo,
    falsePositiveRate: document.false_positive_rate,
    createdAt: fromDate(document.created_at),
  });
}
