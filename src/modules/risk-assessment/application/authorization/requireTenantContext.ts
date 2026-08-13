import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import { forbiddenCrossTenant } from '../../domain/errors/RiskAssessmentError.js';

/**
 * Narrows `AuthContext.organizationId` from `string | null` back to
 * `string` for tenant-scoped risk-assessment use cases (mirrors
 * case-management's `requireTenantContext`).
 */
export function requireTenantContext(auth: AuthContext): string {
  if (auth.organizationId === null) {
    throw forbiddenCrossTenant('this operation requires an organization context');
  }
  return auth.organizationId;
}
