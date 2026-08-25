import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import {
  isObserver,
  ROLE_ADMIN,
  ROLE_ANALYST,
  ROLE_AUDITOR,
  ROLE_SUPERVISOR,
} from '../../../../shared/kernel/AccessTier.js';
import { forbiddenReadOnly, forbiddenRole } from '../../domain/errors/CaseManagementError.js';

/**
 * Política de acceso de case-management, en un único fichero.
 *
 * Antes cada caso de uso declaraba su propia lista (`const CLOSE_ROLES =
 * ['SUPERVISOR', 'ADMIN']`) y la guarda miraba solo `roleId`. Eso tenía dos
 * consecuencias, ambas equivocadas:
 *
 * 1. `ADMIN` podía dictaminar, cerrar, sancionar y borrar evidencia — el
 *    mismo actor que da y quita permisos.
 * 2. El actor `ORGANIZATION` llega SIEMPRE con `roleId: null` (el resolver
 *    de sesión solo resuelve rol para el actor `USER`), así que hasta las
 *    lecturas le respondían `role "null" is not authorized`.
 *
 * Ahora hay dos guardas explícitas —lectura y operación— y las listas viven
 * aquí. Ver `shared/kernel/AccessTier.ts` para el porqué de la separación.
 */

/** Instruir un expediente: notas, prioridad, etiquetas, dictamen, lotes. */
export const CASE_WORK_ROLES: readonly string[] = [ROLE_ANALYST, ROLE_SUPERVISOR];

/**
 * Actos irreversibles o de autoridad: cerrar, reabrir, aprobar/rechazar y
 * ejecutar sanciones, borrar notas y evidencia, y tocar las reglas de
 * enrutamiento. Solo el supervisor.
 */
export const SUPERVISION_ROLES: readonly string[] = [ROLE_SUPERVISOR];

/**
 * Repartir trabajo: asignar y reasignar expedientes.
 *
 * SOLO el `ADMIN`. El reparto de trabajo es una decisión de quien administra
 * personas, no de quien las hace: un analista no elige su carga y un
 * supervisor no se queda los casos que prefiere.
 *
 * Junto con `AssignmentGate` esto define el flujo del departamento: los casos
 * entran, el enrutamiento automático los reparte cuando alguna regla casa, y
 * lo que quede huérfano espera a que el ADMIN lo adjudique. Nadie trabaja un
 * expediente que no le dieron.
 *
 * EL COSTE, dicho: sin un ADMIN disponible los casos sin asignar se quedan
 * congelados. No es un efecto colateral, es la consecuencia directa de que el
 * reparto sea una sola puerta.
 */
export const CASE_ASSIGN_ROLES: readonly string[] = [ROLE_ADMIN];

/**
 * Guarda de ASIGNACIÓN. No pasa por `isObserver` a propósito.
 *
 * `requireOperationalRole` rechaza a todo observador antes de mirar la lista,
 * que es lo correcto para instruir; aquí la lista SÍ manda, porque el `ADMIN`
 * es observador de expedientes y aun así reparte el trabajo. Poner esta
 * excepción en su propia guarda —en vez de abrir un hueco en la otra— es lo
 * que evita que mañana se cuele por ahí algo que sí instruye.
 */
export function requireAssignmentRole(auth: AuthContext): void {
  if (
    auth.actorType !== 'USER' ||
    auth.roleId === null ||
    !CASE_ASSIGN_ROLES.includes(auth.roleId)
  ) {
    throw forbiddenRole(auth.roleId, CASE_ASSIGN_ROLES);
  }
}

/** Lectura de gobierno: cola de sanciones, reglas, exportaciones. */
export const OVERSIGHT_READ_ROLES: readonly string[] = [ROLE_SUPERVISOR, ROLE_ADMIN, ROLE_AUDITOR];

/**
 * Guarda de ESCRITURA. Exige un actor `USER` con rol operativo permitido.
 *
 * El actor `ORGANIZATION` y los roles observadores (`ADMIN`, `AUDITOR`) se
 * rechazan con un mensaje que dice que su acceso es de solo lectura, en vez
 * del críptico `role "null"` que devolvía la guarda anterior.
 */
export function requireOperationalRole(auth: AuthContext, allowed: readonly string[]): void {
  if (isObserver(auth)) {
    throw forbiddenReadOnly(auth, allowed);
  }
  if (auth.actorType !== 'USER' || auth.roleId === null || !allowed.includes(auth.roleId)) {
    throw forbiddenRole(auth.roleId, allowed);
  }
}

/**
 * Guarda de LECTURA. El actor `ORGANIZATION` pasa siempre —es dueño del
 * inquilino y no puede ver menos que sus propios usuarios—; el actor `USER`
 * se somete a la lista.
 */
export function requireReadRole(auth: AuthContext, allowed: readonly string[]): void {
  if (auth.actorType === 'ORGANIZATION') {
    return;
  }
  if (auth.roleId === null || !allowed.includes(auth.roleId)) {
    throw forbiddenRole(auth.roleId, allowed);
  }
}
