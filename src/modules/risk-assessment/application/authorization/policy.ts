import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import {
  isObserver,
  ROLE_ADMIN,
  ROLE_AUDITOR,
  ROLE_SUPERVISOR,
} from '../../../../shared/kernel/AccessTier.js';
import { forbiddenReadOnly, forbiddenRole } from '../../domain/errors/RiskAssessmentError.js';

/**
 * Risk-assessment access policy. Mirror of
 * `case-management/application/authorization/policy.ts`: writes are
 * operational, reads are governance.
 *
 * A scoring rule decides which customers land in the fraud inbox — it is
 * an operational lever, not a configuration preference. That is why the
 * SUPERVISOR drafts and activates it, and ADMIN, who administers people,
 * only reads it.
 */
export const SCORING_RULE_WRITE_ROLES: readonly string[] = [ROLE_SUPERVISOR];
export const SCORING_RULE_READ_ROLES: readonly string[] = [
  ROLE_SUPERVISOR,
  ROLE_ADMIN,
  ROLE_AUDITOR,
];

export function requireOperationalRole(auth: AuthContext, allowed: readonly string[]): void {
  if (isObserver(auth)) {
    throw forbiddenReadOnly(auth, allowed);
  }
  if (auth.actorType !== 'USER' || auth.roleId === null || !allowed.includes(auth.roleId)) {
    throw forbiddenRole(auth.roleId, allowed);
  }
}

/** The ORGANIZATION actor owns the tenant: they read everything their users read. */
export function requireReadRole(auth: AuthContext, allowed: readonly string[]): void {
  if (auth.actorType === 'ORGANIZATION') {
    return;
  }
  if (auth.roleId === null || !allowed.includes(auth.roleId)) {
    throw forbiddenRole(auth.roleId, allowed);
  }
}
