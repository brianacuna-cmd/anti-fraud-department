import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import { isObserver, ROLE_SUPERVISOR } from '../../../../shared/kernel/AccessTier.js';
import { forbiddenReadOnly, forbiddenRole } from '../../domain/errors/NotificationsError.js';

/**
 * notifications-owned access policy (design ADR-5), mirroring
 * `case-management`/`ingest`'s own `policy.ts` — a module may not import
 * another module's `application` layer (eslint `boundaries`), so each module
 * keeps its own copy rather than sharing one.
 */
export const SUPERVISION_ROLES: readonly string[] = [ROLE_SUPERVISOR];

export function requireOperationalRole(auth: AuthContext, allowed: readonly string[]): void {
  if (isObserver(auth)) {
    throw forbiddenReadOnly(auth, allowed);
  }
  if (auth.actorType !== 'USER' || auth.roleId === null || !allowed.includes(auth.roleId)) {
    throw forbiddenRole(auth.roleId, allowed);
  }
}
