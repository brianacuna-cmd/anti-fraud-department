import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import { isObserver, ROLE_SUPERVISOR } from '../../../../shared/kernel/AccessTier.js';
import { forbiddenReadOnly, forbiddenRole } from '../../domain/errors/SarError.js';

/**
 * Drafting a SAR is a compliance authority act — same tier as
 * case-management's SUPERVISION_ROLES (close/reopen/approve sanctions):
 * SUPERVISOR only. ADMIN administers people, not regulatory filings.
 */
export const SAR_WRITE_ROLES: readonly string[] = [ROLE_SUPERVISOR];

export function requireOperationalRole(auth: AuthContext, allowed: readonly string[]): void {
  if (isObserver(auth)) {
    throw forbiddenReadOnly(auth, allowed);
  }
  if (auth.actorType !== 'USER' || auth.roleId === null || !allowed.includes(auth.roleId)) {
    throw forbiddenRole(auth.roleId, allowed);
  }
}
