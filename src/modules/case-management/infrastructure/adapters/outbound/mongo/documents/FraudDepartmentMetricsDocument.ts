/**
 * Mongo document shape for `fraud_department_metrics`. One document per
 * (organization_id, fecha) Bogota calendar day, enforced by the
 * `fraud_department_metrics_org_fecha_unique` index (design: MET-003).
 */

import type { ObjectId } from 'mongodb';

export interface FraudDepartmentMetricsDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  /** Bogota calendar day the row belongs to, 'YYYY-MM-DD'. */
  readonly fecha: string;
  readonly casos_abiertos: number;
  readonly casos_cerrados: number;
  readonly sla_compliance_pct: number | null;
  readonly precision_modelo: number | null;
  readonly false_positive_rate: number | null;
  readonly created_at: Date;
}
