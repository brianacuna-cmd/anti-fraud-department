import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import { forbiddenCrossTenant } from '../../domain/errors/IdentityAccessError.js';

/**
 * Scoped organization-actor guard (design "7. `requireOrganizationActor`
 * guard", user-roles PR-1b). Mirrors `requirePlatformAdmin.ts` exactly.
 * Gates EXACTLY two operations: `CreateUser`'s role-assignment path and
 * `ChangeUserRole` (PR-2) — nothing else. It must NOT be applied to
 * `/users/me/...` self-service routes or to the existing patch/transition/
 * delete user routes, which stay on `requireTenantContext` alone.
 */
export function requireOrganizationActor(auth: AuthContext): void {
  if (auth.actorType !== 'ORGANIZATION') {
    throw forbiddenCrossTenant('this operation requires an organization actor');
  }
}
