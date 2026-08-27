import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import { isObserver, ROLE_SUPERVISOR } from '../../../../shared/kernel/AccessTier.js';
import { forbiddenReadOnly, forbiddenRole } from '../../domain/errors/IngestError.js';

/**
 * Ingest access policy. Mirror of
 * `case-management/application/authorization/policy.ts`.
 *
 * An inbound webhook secret is the credential an external provider uses to
 * push cases into the system: rotating it is an operational act with
 * immediate effect on ingest, so it stays with SUPERVISOR. The governance
 * plane (ORGANIZATION, ADMIN, AUDITOR) does not touch it.
 */
export const SECRET_WRITE_ROLES: readonly string[] = [ROLE_SUPERVISOR];

export function requireOperationalRole(auth: AuthContext, allowed: readonly string[]): void {
  if (isObserver(auth)) {
    throw forbiddenReadOnly(auth, allowed);
  }
  if (auth.actorType !== 'USER' || auth.roleId === null || !allowed.includes(auth.roleId)) {
    throw forbiddenRole(auth.roleId, allowed);
  }
}
