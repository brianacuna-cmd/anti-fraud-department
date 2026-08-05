import type { Organization } from '../model/aggregates/Organization.js';
import type { OrganizationId } from '../model/value-objects/OrganizationId.js';
import type { Slug } from '../model/value-objects/Slug.js';
import type { Transaction } from './UnitOfWork.js';

export interface OrganizationListPage {
  readonly items: readonly Organization[];
  readonly nextCursor: string | null;
}

/**
 * Outbound port for the `Organization` aggregate (design D7: no
 * `TenantContext` binding — organizations ARE the tenant root, gated
 * instead by `requirePlatformAdmin` at the application layer).
 *
 * `save`/`findBySlug` take an optional `Transaction` handle so
 * `CreateOrganizationWithAdmin` (Phase 3) can thread the SAME Mongo session
 * used for the admin `User` write — genuine cross-collection atomicity
 * (design D6). Phase 2's single-aggregate use cases simply omit it.
 */
export interface OrganizationRepository {
  save(organization: Organization, tx?: Transaction): Promise<void>;
  findById(id: OrganizationId): Promise<Organization | null>;
  findBySlug(slug: Slug, tx?: Transaction): Promise<Organization | null>;
  list(limit: number, cursor?: string): Promise<OrganizationListPage>;
}
