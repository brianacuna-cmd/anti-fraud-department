import type { OrganizationId } from '../model/value-objects/OrganizationId.js';
import type { UserRepository } from './UserRepository.js';

/**
 * Builds a tenant-bound `UserRepository` (design D8). Regular use cases bind
 * to the caller's own `auth.organizationId`; the cross-tenant bootstrap
 * (`CreateOrganizationWithAdmin`) is the ONE legal exception — it binds to
 * the NEW organization's id instead, per Addendum §C.4 ("new repo with a
 * different TenantContext" is the only legal tenant crossing).
 */
export interface UserRepositoryFactory {
  forTenant(organizationId: OrganizationId): UserRepository;
}
