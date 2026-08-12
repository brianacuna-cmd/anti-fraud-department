import type { OrganizationFraudConfig } from '../model/aggregates/OrganizationFraudConfig.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Outbound port for the per-tenant `OrganizationFraudConfig` singleton
 * (design: "OrganizationFraudConfigRepository"). `upsert` is idempotent by
 * `OrganizationId` — uniqueness is enforced by the `org_fraud_config_unique`
 * index, never re-checked in application code.
 */
export interface OrganizationFraudConfigRepository {
  upsert(config: OrganizationFraudConfig, tx?: Transaction): Promise<void>;
  findByOrganization(organizationId: string, tx?: Transaction): Promise<OrganizationFraudConfig | null>;
}
