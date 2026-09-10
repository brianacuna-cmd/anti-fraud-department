import type { FraudDepartmentMetrics } from '../model/aggregates/FraudDepartmentMetrics.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Outbound port for the nightly `fraud_department_metrics` rows (design:
 * MET-003). `upsert` MUST be idempotent by the natural key
 * `(organizationId, fecha)`: re-running the aggregation for the same day
 * updates the existing row in place and never creates a duplicate —
 * uniqueness is ultimately enforced by the `fraud_department_metrics_org_fecha_unique`
 * index, never re-checked in application code (mirrors
 * `OrganizationFraudConfigRepository.upsert`).
 */
export interface FraudDepartmentMetricsRepository {
  upsert(metrics: FraudDepartmentMetrics, tx?: Transaction): Promise<void>;
  findByOrgAndDate(
    organizationId: string,
    fecha: string,
    tx?: Transaction,
  ): Promise<FraudDepartmentMetrics | null>;
}
