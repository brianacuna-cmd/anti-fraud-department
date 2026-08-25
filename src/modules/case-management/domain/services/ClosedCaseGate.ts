import type { Case } from '../model/aggregates/Case.js';
import { caseClosed } from '../errors/CaseManagementError.js';

/** Los dos estados en que el expediente ya no se instruye. */
const CLOSED_STATUSES = new Set(['RESOLVED', 'ARCHIVED']);

export function isClosed(kase: Case): boolean {
  return CLOSED_STATUSES.has(kase.status);
}

/**
 * Un expediente cerrado no se instruye.
 *
 * Ni notas, ni evidencia, ni investigaciones, ni dictámenes, ni medidas, ni
 * cambios de prioridad o etiquetas. Si hace falta seguir trabajándolo, el
 * camino es reabrirlo — y eso deja su propio hito en la cronología.
 *
 * POR QUÉ IMPORTA MÁS AQUÍ QUE EN OTRO SISTEMA
 *
 * El informe congelado se genera al cerrar. Permitir que después se añada
 * evidencia produce la peor combinación posible: un expediente cuyo contenido
 * real ya no coincide con el documento que se entregó como su foto
 * inmutable. Quien reciba ese informe estará leyendo algo que la base de
 * datos ya contradice, y no habrá forma de saber cuál de los dos vale.
 *
 * Reabrir, en cambio, es explícito: exige justificación, reinicia el SLA,
 * queda registrado, y el informe siguiente se genera sobre el estado nuevo.
 *
 * QUÉ NO CUBRE
 *
 * `GenerateCaseReport` no pasa por aquí a propósito: congelar el expediente
 * es precisamente lo que se hace DESPUÉS de cerrarlo. Y `ReassignCase`
 * tampoco — cambiar de responsable no altera el contenido del expediente y
 * es lo que hace falta para que otra persona pueda reabrirlo.
 */
export function assertNotClosed(kase: Case): void {
  if (isClosed(kase)) {
    throw caseClosed(kase.id, kase.status);
  }
}
