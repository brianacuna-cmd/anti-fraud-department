import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import type { UserRepositoryFactory } from '../../domain/ports/UserRepositoryFactory.js';
import { createOrganizationId } from '../../domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../domain/model/value-objects/UserId.js';
import { forbiddenRole } from '../../domain/errors/IdentityAccessError.js';
import { requireTenantContext } from './requireTenantContext.js';

/**
 * Role catalogs for USER-tier authorization (role-authorization). The
 * ORGANIZATION actor always passes both gates — it owns the tenant. For a
 * USER actor, the acting user's `roleId` decides:
 *
 * - MANAGE (create/patch/transition/delete/role-change other users):
 *   `ADMIN` only.
 * - READ (list/get other users): `ADMIN`, `SUPERVISOR`, `AUDITOR` —
 *   `ANALYST` works cases, not people, and only ever sees `/users/me`.
 */
export const USER_MANAGE_ROLES: readonly string[] = ['ADMIN'];
export const USER_READ_ROLES: readonly string[] = ['ADMIN', 'SUPERVISOR', 'AUDITOR'];

/**
 * Resolves the ACTING user's role from persistence and enforces the given
 * allow-list. `AuthContext.roleId` is deliberately not trusted here: the
 * session resolver never populates it, and a stale value would survive a
 * role change mid-session — the repository row is the source of truth.
 *
 * Throws `FORBIDDEN_ROLE` (403) when the acting USER's role is not
 * allow-listed. ORGANIZATION and PLATFORM_ADMIN pass without a role check —
 * la organización es dueña del tenant y el platform admin es el operador
 * global (la reactivación DISABLED->ACTIVE lo exige a nivel de dominio).
 */
export async function requireUserRole(
  auth: AuthContext,
  userRepositoryFactory: UserRepositoryFactory,
  allowedRoles: readonly string[],
  operation: string,
): Promise<void> {
  // ORGANIZATION es dueña del tenant; PLATFORM_ADMIN es el operador global
  // (p. ej. la reactivación DISABLED->ACTIVE exige platform admin a nivel de
  // dominio). Solo el actor USER se somete al chequeo de rol.
  if (auth.actorType !== 'USER') {
    return;
  }

  const repository = userRepositoryFactory.forTenant(createOrganizationId(requireTenantContext(auth)));
  const actor = await repository.findById(createUserId(auth.userId));
  if (!actor || !allowedRoles.includes(actor.roleId)) {
    throw forbiddenRole(actor?.roleId ?? null, operation);
  }
}
