import { brand, type Brand } from './Brand.js';

export type TenantId = Brand<string, 'TenantId'>;

/**
 * Binds tenant-scoped Mongo repositories to a single organization by
 * construction (ESTRUCTURA_REPO.md §1, Addendum §C.4) — a query built without
 * a `TenantContext` has no way to omit the tenant filter, rather than relying
 * on every repository method remembering to add it.
 *
 * Deliberately generic over the raw tenant id string rather than the
 * `OrganizationId` branded type: `shared/kernel` cannot depend on
 * `identity-access/domain` (inter-module dependency direction, design D1),
 * so the identity-access module narrows/re-brands at its own boundary.
 */
export class TenantContext {
  private constructor(readonly tenantId: TenantId) {}

  static of(tenantId: string): TenantContext {
    if (tenantId.length === 0) {
      throw new Error('TenantContext requires a non-empty tenant id');
    }
    return new TenantContext(brand<string, 'TenantId'>(tenantId));
  }

  equals(other: TenantContext): boolean {
    return this.tenantId === other.tenantId;
  }
}
