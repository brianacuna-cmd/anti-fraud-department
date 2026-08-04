import { buildCursorPage } from '../../../src/shared/http/pagination.js';
import { User } from '../../../src/modules/identity-access/domain/model/aggregates/User.js';
import type { UserListPage, UserRepository } from '../../../src/modules/identity-access/domain/ports/UserRepository.js';
import type { UserId } from '../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import type { OrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import type { Email } from '../../../src/modules/identity-access/domain/model/value-objects/Email.js';

/**
 * In-memory `UserRepository` fake bound to a single tenant (mirrors
 * `InMemoryOrganizationRepository`'s role for Phase 2). Filters every
 * lookup/list by the bound `organizationId` — the same tenant-scoping
 * guarantee `MongoUserRepository` gives via its constructor binding.
 */
export class InMemoryUserRepository implements UserRepository {
  constructor(
    private readonly organizationId: OrganizationId,
    private readonly byId: Map<string, User>,
  ) {}

  async save(user: User): Promise<void> {
    this.byId.set(user.id, user);
  }

  async findById(id: UserId): Promise<User | null> {
    const user = this.byId.get(id);
    return user && this.belongsToTenant(user) ? user : null;
  }

  async findByEmail(email: Email): Promise<User | null> {
    for (const user of this.byId.values()) {
      if (this.belongsToTenant(user) && (user.email as string) === (email as string)) {
        return user;
      }
    }
    return null;
  }

  async list(limit: number, cursor?: string): Promise<UserListPage> {
    const tenantUsers = [...this.byId.values()].filter((user) => this.belongsToTenant(user));
    const startIndex = cursor ? tenantUsers.findIndex((user) => (user.id as string) === cursor) + 1 : 0;
    const users = tenantUsers.slice(startIndex);

    const wrapped = users.map((user) => ({ value: user, cursorId: user.id as string }));
    const page = buildCursorPage(wrapped, limit);
    return { items: page.items.map((entry) => entry.value), nextCursor: page.nextCursor };
  }

  private belongsToTenant(user: User): boolean {
    return (user.organizationId as string) === (this.organizationId as string);
  }
}
