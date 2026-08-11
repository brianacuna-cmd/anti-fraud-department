import type { RoleId } from '../../../src/modules/identity-access/domain/model/value-objects/RoleId.js';
import { isAssignableUserRole } from '../../../src/modules/identity-access/domain/model/value-objects/RoleId.js';
import type { RoleRepository, RoleView } from '../../../src/modules/identity-access/domain/ports/RoleRepository.js';

/** Builds a default ACTIVE `RoleView` for the known catalog ids. */
export function buildRoleView(id: string, overrides: Partial<Omit<RoleView, 'id'>> = {}): RoleView {
  return {
    id: id as RoleId,
    name: overrides.name ?? id,
    status: overrides.status ?? 'ACTIVE',
    deletedAt: overrides.deletedAt ?? null,
  };
}

const DEFAULT_ROLES: readonly RoleView[] = [
  buildRoleView('ADMIN', { name: 'Administrator' }),
  buildRoleView('SUPERVISOR', { name: 'Supervisor' }),
  buildRoleView('ANALYST', { name: 'Analyst' }),
  buildRoleView('AUDITOR', { name: 'Auditor' }),
];

/**
 * In-memory `RoleRepository` fake (design Testing Strategy: "in-memory
 * fakes for ports"), mirrors `InMemoryAdminOrganizationRepository`. Seeded
 * in the ctor with the 4 known roles so tests get a realistic catalog by
 * default; `withRoles` lets a test override the catalog for
 * inactive/soft-deleted-role scenarios.
 */
export class InMemoryRoleRepository implements RoleRepository {
  private readonly byId = new Map<string, RoleView>();

  constructor(roles: readonly RoleView[] = DEFAULT_ROLES) {
    for (const role of roles) {
      this.byId.set(role.id, role);
    }
  }

  async findById(id: RoleId): Promise<RoleView | null> {
    return this.byId.get(id) ?? null;
  }

  async exists(id: RoleId): Promise<boolean> {
    return this.byId.has(id);
  }

  async isAssignableToUser(id: RoleId): Promise<boolean> {
    if (!isAssignableUserRole(id)) {
      return false;
    }
    const role = this.byId.get(id);
    return role !== undefined && role.status === 'ACTIVE' && role.deletedAt === null;
  }
}

/** Convenience factory: an `InMemoryRoleRepository` seeded with a custom catalog. */
export function withRoles(roles: readonly RoleView[]): InMemoryRoleRepository {
  return new InMemoryRoleRepository(roles);
}
