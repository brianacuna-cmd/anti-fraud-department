import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import { isObserver, ROLE_SUPERVISOR } from '../../../../shared/kernel/AccessTier.js';
import { forbiddenReadOnly, forbiddenRole } from '../../domain/errors/IngestError.js';

/**
 * Política de acceso de ingest. Espejo de
 * `case-management/application/authorization/policy.ts`.
 *
 * El secreto de un webhook entrante es la credencial con la que un proveedor
 * externo mete casos en el sistema: rotarlo es un acto operativo con efecto
 * inmediato sobre la ingesta, así que queda en el SUPERVISOR. El plano de
 * gobierno (ORGANIZATION, ADMIN, AUDITOR) no lo toca.
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
