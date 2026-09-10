import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import { forbiddenCrossTenant } from '../../domain/errors/PrivacyError.js';

/**
 * Narrows `AuthContext.organizationId` from `string | null` back to `string`
 * for tenant-scoped privacy use cases (mirrors sar's `requireTenantContext`).
 */
export function requireTenantContext(auth: AuthContext): string {
  if (auth.organizationId === null) {
    throw forbiddenCrossTenant('this operation requires an organization context');
  }
  return auth.organizationId;
}
