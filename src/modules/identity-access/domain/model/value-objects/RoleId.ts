import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { invariantViolation } from '../../errors/IdentityAccessError.js';

/**
 * Fixed role catalog (design "RoleId VO", user-roles). `RoleId` is the
 * compile-time/format gate over the closed set of known role ids — it
 * validates SHAPE, not runtime existence/Active state (that is
 * `RoleRepository`'s job). Mirrors `OrganizationStatus`'s closed-set factory
 * pattern.
 */
export type RoleId = Brand<string, 'RoleId'>;

export type RoleName = 'ADMIN' | 'SUPERVISOR' | 'ANALYST' | 'AUDITOR';

const KNOWN_ROLE_IDS: ReadonlySet<string> = new Set<RoleName>([
  'ADMIN',
  'SUPERVISOR',
  'ANALYST',
  'AUDITOR',
]);

/**
 * Roles that may be assigned to a `User` — deliberately EXCLUDES `ADMIN`,
 * which is the Organization's own role and never a User's (defense in
 * depth: also enforced at runtime by `RoleRepository.isAssignableToUser`).
 */
export const ASSIGNABLE_USER_ROLES: ReadonlySet<string> = new Set<RoleName>([
  'SUPERVISOR',
  'ANALYST',
  'AUDITOR',
]);

/** Validates a raw id against the closed known-role-id set. */
export function createRoleId(value: string): RoleId {
  if (!KNOWN_ROLE_IDS.has(value)) {
    throw invariantViolation('RoleId must be one of ADMIN, SUPERVISOR, ANALYST, AUDITOR', {
      value,
    });
  }
  return brand<string, 'RoleId'>(value);
}

/** `true` for SUPERVISOR/ANALYST/AUDITOR; `false` for ADMIN and any unknown value. */
export function isAssignableUserRole(value: string): boolean {
  return ASSIGNABLE_USER_ROLES.has(value);
}
