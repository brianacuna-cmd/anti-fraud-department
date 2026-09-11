import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import { ROLE_ADMIN, ROLE_AUDITOR } from '../../../../shared/kernel/AccessTier.js';
import { forbiddenCrossTenant, forbiddenRole } from '../../domain/errors/AuditError.js';

/**
 * Quién puede LEER la bitácora: el plano de observación, y solo él.
 *
 * ADMIN y AUDITOR existen precisamente para mirar el inquilino sin operarlo, y
 * la auditoría es el instrumento de ese trabajo. SUPERVISOR y ANALYST quedan
 * fuera a propósito, aunque tengan más autoridad operativa: son los actores
 * cuyas acciones registra la bitácora, y un investigado que puede leer —y
 * cronometrar— el registro de lo que hizo convierte la traza en un aviso.
 *
 * Es la misma razón por la que en una empresa la auditoría interna no reporta
 * a quien audita.
 */
export const AUDIT_READ_ROLES: readonly string[] = [ROLE_ADMIN, ROLE_AUDITOR];

export function requireAuditReader(auth: AuthContext): void {
  // Un PLATFORM_ADMIN opera por encima de los inquilinos: audita la plataforma.
  if (auth.actorType === 'PLATFORM_ADMIN') return;
  // Un actor ORGANIZATION es el administrador del propio inquilino.
  if (auth.actorType === 'ORGANIZATION') return;

  if (auth.actorType !== 'USER' || auth.roleId === null || !AUDIT_READ_ROLES.includes(auth.roleId)) {
    throw forbiddenRole(auth.roleId, AUDIT_READ_ROLES);
  }
}

/**
 * De qué inquilino puede leer.
 *
 * Solo un PLATFORM_ADMIN obtiene `null` —toda la plataforma—. Para el resto
 * sale de la SESIÓN y nunca de la petición: si el cliente pudiera mandarlo,
 * cambiar un parámetro bastaría para leer la auditoría de otro inquilino.
 */
export function auditScopeFor(auth: AuthContext): string | null {
  if (auth.actorType === 'PLATFORM_ADMIN') return null;
  if (auth.organizationId === null) {
    throw forbiddenCrossTenant('this operation requires an organization context');
  }
  return auth.organizationId;
}
