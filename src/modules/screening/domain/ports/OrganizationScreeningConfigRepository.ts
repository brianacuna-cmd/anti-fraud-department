import type { OrganizationScreeningConfig } from '../model/aggregates/OrganizationScreeningConfig.js';

/**
 * Outbound port for the per-tenant `OrganizationScreeningConfig` singleton
 * (design D-6). `upsert` is idempotent by `OrganizationId` — uniqueness is
 * enforced by the `org_screening_config_unique` index, never re-checked in
 * application code. `findByOrganization` returns `null` when no row exists
 * (NOT a not-found error — RF-6 defaults apply upstream).
 */
export interface OrganizationScreeningConfigRepository {
  upsert(config: OrganizationScreeningConfig): Promise<void>;
  findByOrganization(organizationId: string): Promise<OrganizationScreeningConfig | null>;
}
