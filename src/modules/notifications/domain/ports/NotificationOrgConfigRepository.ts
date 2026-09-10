import type { NotificationOrgConfig } from '../model/aggregates/NotificationOrgConfig.js';
import type { OrganizationId } from '../model/value-objects/OrganizationId.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Port for `NotificationOrgConfig` persistence (design PR1). Per-tenant
 * singleton — `upsert` is the single atomic write path, mirrors
 * `OrganizationFraudConfigRepository`.
 */
export interface NotificationOrgConfigRepository {
  upsert(config: NotificationOrgConfig, tx?: Transaction): Promise<void>;
  findByOrganization(organizationId: OrganizationId, tx?: Transaction): Promise<NotificationOrgConfig | null>;
}
