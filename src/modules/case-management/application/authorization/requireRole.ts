import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import { forbiddenRole } from '../../domain/errors/CaseManagementError.js';

/**
 * Gate on `AuthContext.roleId` for role-restricted case-management
 * operations (design: reopen requires SUPERVISOR|ADMIN). Throws
 * `FORBIDDEN_ROLE` when the caller's role is missing or not in `allowed`.
 */
export function requireRole(auth: AuthContext, allowed: readonly string[]): void {
  if (auth.roleId === null || !allowed.includes(auth.roleId)) {
    throw forbiddenRole(auth.roleId, allowed);
  }
}
