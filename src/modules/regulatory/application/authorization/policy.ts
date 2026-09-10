import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import { isObserver, ROLE_SUPERVISOR } from '../../../../shared/kernel/AccessTier.js';
import { forbiddenReadOnly, forbiddenRole } from '../../domain/errors/RegulatoryError.js';

/**
 * Compilar y emitir un reporte regulatorio es un acto de autoridad de
 * cumplimiento: SUPERVISOR, el mismo nivel que redactar un SAR o autorizar una
 * sanción.
 *
 * Y por la misma razón que en `sar`: el documento sale del edificio con el
 * nombre del inquilino encima. La traza de auditoría tiene que nombrar a
 * alguien que pudiera firmarlo legítimamente.
 */
export const REGULATORY_WRITE_ROLES: readonly string[] = [ROLE_SUPERVISOR];

export function requireOperationalRole(auth: AuthContext, allowed: readonly string[]): void {
  if (isObserver(auth)) {
    throw forbiddenReadOnly(auth, allowed);
  }
  if (auth.actorType !== 'USER' || auth.roleId === null || !allowed.includes(auth.roleId)) {
    throw forbiddenRole(auth.roleId, allowed);
  }
}
