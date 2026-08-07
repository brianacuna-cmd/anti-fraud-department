import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import { forbiddenCrossTenant } from '../../domain/errors/IdentityAccessError.js';

/**
 * Narrows `AuthContext.organizationId` from `string | null` back to
 * `string` for every tenant-scoped use case (design D11). A `null`
 * `organizationId` means the caller is acting with no tenant context (a
 * platform administrator) — tenant-scoped routes are not reachable by that
 * actor, so this throws rather than letting a sentinel value silently
 * satisfy a tenant filter (the exact cross-tenant leak D11 exists to close).
 */
export function requireTenantContext(auth: AuthContext): string {
  if (auth.organizationId === null) {
    throw forbiddenCrossTenant('this operation requires an organization context');
  }
  return auth.organizationId;
}
