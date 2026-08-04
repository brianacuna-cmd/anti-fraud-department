import type { User } from '../../../src/modules/identity-access/domain/model/aggregates/User.js';
import type { UserRepositoryFactory } from '../../../src/modules/identity-access/domain/ports/UserRepositoryFactory.js';
import type { OrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import type { Email } from '../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { InMemoryUserRepository } from './InMemoryUserRepository.js';

/**
 * In-memory `UserRepositoryFactory` fake. Shares ONE backing map across every
 * tenant-bound repository it hands out, so cross-tenant isolation is proven
 * by the returned `InMemoryUserRepository`'s own filtering, not by separate
 * storage per tenant (matching how one real `users` collection holds every
 * tenant's documents in Mongo).
 */
export class InMemoryUserRepositoryFactory implements UserRepositoryFactory {
  private readonly byId = new Map<string, User>();

  forTenant(organizationId: OrganizationId): InMemoryUserRepository {
    return new InMemoryUserRepository(organizationId, this.byId);
  }

  async existsByEmailAcrossTenants(email: Email): Promise<boolean> {
    for (const user of this.byId.values()) {
      if ((user.email as string) === (email as string)) {
        return true;
      }
    }
    return false;
  }
}
