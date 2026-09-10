import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import { isObserver, ROLE_SUPERVISOR } from '../../../../shared/kernel/AccessTier.js';
import { forbiddenReadOnly, forbiddenRole } from '../../domain/errors/PrivacyError.js';

/**
 * Handling a data-subject request is a compliance authority act: SUPERVISOR
 * only, the same tier as drafting a SAR or approving a sanction.
 *
 * Not ANALYST, and the reason is specific to this module: PRIV-002 assembles
 * a package of one person's entire file and PRIV-003 destroys identity data
 * irreversibly. Neither is casework — they are decisions the tenant answers
 * for before a regulator, and the audit trail has to name someone who could
 * lawfully make them.
 */
export const PRIVACY_WRITE_ROLES: readonly string[] = [ROLE_SUPERVISOR];

export function requireOperationalRole(auth: AuthContext, allowed: readonly string[]): void {
  if (isObserver(auth)) {
    throw forbiddenReadOnly(auth, allowed);
  }
  if (auth.actorType !== 'USER' || auth.roleId === null || !allowed.includes(auth.roleId)) {
    throw forbiddenRole(auth.roleId, allowed);
  }
}
