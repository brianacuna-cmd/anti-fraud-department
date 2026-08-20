import type { User } from '../model/aggregates/User.js';
import type { UserId } from '../model/value-objects/UserId.js';
import type { RoleId } from '../model/value-objects/RoleId.js';
import type { Email } from '../model/value-objects/Email.js';
import type { Transaction } from './UnitOfWork.js';

export interface UserListPage {
  readonly items: readonly User[];
  readonly nextCursor: string | null;
}

/**
 * Outbound port for the `User` aggregate, always bound to a single tenant
 * (design D7/D8: `MongoUserRepository(tenant, db)` — a query built without a
 * `TenantContext` has no way to omit the tenant filter). Every method here
 * implicitly scopes to whichever organization the repository was bound to
 * via `UserRepositoryFactory.forTenant`.
 *
 * `save` takes an optional `Transaction` handle so `CreateOrganizationWithAdmin`
 * can thread the SAME Mongo session used for the `Organization` write.
 */
export interface UserRepository {
  save(user: User, tx?: Transaction): Promise<void>;
  findById(id: UserId): Promise<User | null>;
  findByEmail(email: Email): Promise<User | null>;
  list(limit: number, cursor?: string): Promise<UserListPage>;
  /** Active users assigned the given role within the bound tenant (notification fan-out). */
  listByRole(roleId: RoleId): Promise<readonly User[]>;
}
