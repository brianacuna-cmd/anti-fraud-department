import type { AuthContext } from './AuthContext.js';

/**
 * Los cuatro roles del catálogo, en un solo sitio.
 *
 * Estaban repartidos como literales sueltos en dos docenas de casos de uso
 * (`const APPROVAL_ROLES = ['SUPERVISOR', 'ADMIN']`, …), de modo que cambiar
 * la política exigía encontrarlos todos y no olvidar ninguno — que es
 * exactamente cómo `ADMIN` terminó pudiendo dictaminar, cerrar y sancionar.
 */
export const ROLE_ADMIN = 'ADMIN';
export const ROLE_SUPERVISOR = 'SUPERVISOR';
export const ROLE_ANALYST = 'ANALYST';
export const ROLE_AUDITOR = 'AUDITOR';

/**
 * Segregación de funciones (SoD).
 *
 * El departamento se parte en dos planos que NO se solapan:
 *
 * - Gobierno — el actor `ORGANIZATION` (dueño del inquilino) y los roles
 *   `ADMIN` y `AUDITOR`. Lo ven todo y no ejecutan nada sobre un expediente.
 *   `ADMIN` administra personas y accesos; `AUDITOR` fiscaliza. Que quien
 *   concede los permisos no pueda además usarlos es el control que impide
 *   que una sola cuenta lleve un caso de fraude de principio a fin sin que
 *   nadie más lo mire.
 * - Operación — `ANALYST` instruye y propone; `SUPERVISOR` revisa, cierra y
 *   autoriza sanciones.
 *
 * `PLATFORM_ADMIN` no aparece aquí a propósito: no tiene inquilino, así que
 * `requireTenantContext` lo detiene antes de que ninguna guarda de rol llegue
 * a mirarlo.
 */
export const OBSERVER_ROLES: readonly string[] = [ROLE_ADMIN, ROLE_AUDITOR];

/** Roles operativos: los únicos que actúan sobre un expediente. */
export const OPERATIONAL_ROLES: readonly string[] = [ROLE_ANALYST, ROLE_SUPERVISOR];

/**
 * `true` cuando el actor pertenece al plano de gobierno: observa el inquilino
 * entero pero no puede modificarlo.
 */
export function isObserver(auth: AuthContext): boolean {
  if (auth.actorType === 'ORGANIZATION') {
    return true;
  }
  return auth.actorType === 'USER' && OBSERVER_ROLES.includes(auth.roleId ?? '');
}

/**
 * Etiqueta con la que un actor sin rol operativo aparece en el mensaje de
 * error. Sin esto la organización se leía como `role "null"`, que no dice
 * nada a quien lo recibe.
 */
export function describeActor(auth: AuthContext): string {
  return auth.actorType === 'USER' ? (auth.roleId ?? 'sin rol') : auth.actorType;
}
