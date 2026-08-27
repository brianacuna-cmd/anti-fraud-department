import type { AuthContext } from './AuthContext.js';

/**
 * The four catalog roles, in one place.
 *
 * They used to be scattered as loose literals across two dozen use cases
 * (`const APPROVAL_ROLES = ['SUPERVISOR', 'ADMIN']`, …), so changing the
 * policy meant finding every copy and not missing any — which is exactly
 * how `ADMIN` ended up able to decide, close, and enforce.
 */
export const ROLE_ADMIN = 'ADMIN';
export const ROLE_SUPERVISOR = 'SUPERVISOR';
export const ROLE_ANALYST = 'ANALYST';
export const ROLE_AUDITOR = 'AUDITOR';

/**
 * Segregation of duties (SoD).
 *
 * The department splits into two planes that do NOT overlap:
 *
 * - Governance — the `ORGANIZATION` actor (tenant owner) and the
 *   `ADMIN` and `AUDITOR` roles. They see everything and execute nothing
 *   on a case. `ADMIN` administers people and access; `AUDITOR` oversees.
 *   That whoever grants permissions cannot also use them is the control
 *   that stops a single account from taking a fraud case from start to
 *   finish without anyone else looking.
 * - Operations — `ANALYST` instructs and proposes; `SUPERVISOR` reviews,
 *   closes, and authorizes enforcement.
 *
 * `PLATFORM_ADMIN` is omitted here on purpose: they have no tenant, so
 * `requireTenantContext` stops them before any role guard ever looks at
 * them.
 */
export const OBSERVER_ROLES: readonly string[] = [ROLE_ADMIN, ROLE_AUDITOR];

/** Operational roles: the only ones that act on a case. */
export const OPERATIONAL_ROLES: readonly string[] = [ROLE_ANALYST, ROLE_SUPERVISOR];

/**
 * `true` when the actor belongs to the governance plane: they observe the
 * whole tenant but cannot modify it.
 */
export function isObserver(auth: AuthContext): boolean {
  if (auth.actorType === 'ORGANIZATION') {
    return true;
  }
  return auth.actorType === 'USER' && OBSERVER_ROLES.includes(auth.roleId ?? '');
}

/**
 * Label used when an actor without an operational role appears in an error
 * message. Without this the organization read as `role "null"`, which tells
 * the recipient nothing.
 */
export function describeActor(auth: AuthContext): string {
  return auth.actorType === 'USER' ? (auth.roleId ?? 'sin rol') : auth.actorType;
}
