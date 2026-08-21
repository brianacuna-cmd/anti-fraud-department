import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import {
  isObserver,
  ROLE_ADMIN,
  ROLE_AUDITOR,
  ROLE_SUPERVISOR,
} from '../../../../shared/kernel/AccessTier.js';
import { forbiddenReadOnly, forbiddenRole } from '../../domain/errors/RiskAssessmentError.js';

/**
 * Política de acceso de risk-assessment. Espejo de
 * `case-management/application/authorization/policy.ts`: la escritura es
 * operativa, la lectura es de gobierno.
 *
 * Una regla de scoring decide qué clientes acaban en la bandeja de fraude —
 * es una palanca operativa, no una preferencia de configuración. Por eso la
 * redacta y la activa el SUPERVISOR, y el ADMIN, que administra a las
 * personas, solo la lee.
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

/** El actor ORGANIZATION es dueño del inquilino: lee todo lo que sus usuarios leen. */
export function requireReadRole(auth: AuthContext, allowed: readonly string[]): void {
  if (auth.actorType === 'ORGANIZATION') {
    return;
  }
  if (auth.roleId === null || !allowed.includes(auth.roleId)) {
    throw forbiddenRole(auth.roleId, allowed);
  }
}
