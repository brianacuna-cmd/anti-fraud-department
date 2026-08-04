import type { OrganizationId } from '../model/value-objects/OrganizationId.js';
import type { Email } from '../model/value-objects/Email.js';
import type { Transaction } from './UnitOfWork.js';
import type { UserRepository } from './UserRepository.js';

/**
 * Builds a tenant-bound `UserRepository` (design D8). Regular use cases bind
 * to the caller's own `auth.organizationId`; the cross-tenant bootstrap
 * (`CreateOrganizationWithAdmin`) is the ONE legal exception — it binds to
 * the NEW organization's id instead, per Addendum §C.4 ("new repo with a
 * different TenantContext" is the only legal tenant crossing).
 *
 * `existsByEmailAcrossTenants` is a SECOND, narrower legal crossing: the
 * atomic bootstrap's admin email must be unique across every organization,
 * not just the brand-new (and therefore always-empty) one being created —
 * a per-tenant `UserRepository.findByEmail` could never observe that by
 * construction, so this one read deliberately spans every tenant.
 */
export interface UserRepositoryFactory {
  forTenant(organizationId: OrganizationId): UserRepository;
  existsByEmailAcrossTenants(email: Email, tx?: Transaction): Promise<boolean>;
}
