import type { Organization } from '../model/aggregates/Organization.js';
import type { OrganizationId } from '../model/value-objects/OrganizationId.js';
import type { Slug } from '../model/value-objects/Slug.js';

export interface OrganizationListPage {
  readonly items: readonly Organization[];
  readonly nextCursor: string | null;
}

/**
 * Outbound port for the `Organization` aggregate (design D7: no
 * `TenantContext` binding — organizations ARE the tenant root, gated
 * instead by `requirePlatformAdmin` at the application layer).
 */
export interface OrganizationRepository {
  save(organization: Organization): Promise<void>;
  findById(id: OrganizationId): Promise<Organization | null>;
  findBySlug(slug: Slug): Promise<Organization | null>;
  list(limit: number, cursor?: string): Promise<OrganizationListPage>;
}
