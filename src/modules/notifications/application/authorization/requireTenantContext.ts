import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import { forbiddenCrossTenant } from '../../domain/errors/NotificationsError.js';

/**
 * Narrows `AuthContext.organizationId` from `string | null` back to
 * `string` (design D6, copied from identity-access's own
 * `requireTenantContext`). A `null` `organizationId` means the caller is
 * acting with no tenant context (a platform administrator) — every
 * notifications use case is self-only and tenant-scoped, so this throws
 * rather than letting a sentinel value silently satisfy a tenant filter.
 */
export function requireTenantContext(auth: AuthContext): string {
  if (auth.organizationId === null) {
    throw forbiddenCrossTenant('this operation requires an organization context');
  }
  return auth.organizationId;
}
