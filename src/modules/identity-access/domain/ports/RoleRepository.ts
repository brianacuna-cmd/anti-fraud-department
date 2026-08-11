import type { RoleId } from '../model/value-objects/RoleId.js';
import type { Instant } from '../../../../shared/time/Instant.js';

/**
 * Light read-model for the fixed role catalog (design "3. `RoleRepository`
 * port"). The catalog is read-only reference data — no mutators, no
 * rehydrate/create ceremony, unlike a full aggregate.
 */
export interface RoleView {
  readonly id: RoleId;
  readonly name: string;
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly deletedAt: Instant | null;
}

/**
 * Outbound port for the `Rol` catalog (design "3. `RoleRepository` port",
 * user-roles). NOT tenant-scoped — a global catalog, like
 * `OrganizationRepository` has no tenant binding.
 */
export interface RoleRepository {
  findById(id: RoleId): Promise<RoleView | null>;
  exists(id: RoleId): Promise<boolean>;
  /**
   * The authoritative runtime gate: exists && Status ACTIVE && DeletedAt
   * null && the id is in `ASSIGNABLE_USER_ROLES` (excludes ADMIN, defense in
   * depth alongside the `RoleId` VO's own helper).
   */
  isAssignableToUser(id: RoleId): Promise<boolean>;
}
