import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import { forbiddenCrossTenant } from '../../domain/errors/CaseManagementError.js';

/**
 * Narrows `AuthContext.organizationId` from `string | null` back to
 * `string` for every tenant-scoped case-management use case (mirrors
 * identity-access's `requireTenantContext`). A `null` `organizationId`
 * means the caller has no tenant context — tenant-scoped routes are not
 * reachable by that actor.
 */
export function requireTenantContext(auth: AuthContext): string {
  if (auth.organizationId === null) {
    throw forbiddenCrossTenant('this operation requires an organization context');
  }
  return auth.organizationId;
}
