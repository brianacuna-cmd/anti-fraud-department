import type { Case } from '../model/aggregates/Case.js';
import { caseNotAssigned } from '../errors/CaseManagementError.js';

/**
 * Un expediente sin responsable está congelado.
 *
 * Mientras `assignedTo` sea `null` el caso no sale de `OPEN`: no se pasa a
 * revisión, no se le añaden notas ni evidencia, no se abre investigación, no
 * se dictamina, no se piden medidas y no se cierra.
 *
 * POR QUÉ EN EL DOMINIO Y NO EN CADA CASO DE USO
 *
 * Son ocho caminos los que tocan un expediente. Una comprobación repetida en
 * ocho sitios acaba estando en siete — es la misma razón por la que la regla
 * de los cuatro ojos vive en el agregado `ApprovalRequest` y no en los tres
 * casos de uso que deciden una solicitud.
 *
 * POR QUÉ NO ES UN PROBLEMA DE PERMISOS
 *
 * Quien lo intenta puede tener el rol perfecto. Lo que falta es que alguien
 * responda por el expediente. Por eso el error es `CASE_NOT_ASSIGNED` (409) y
 * no `FORBIDDEN_ROLE` (403): se arregla asignando el caso, no cambiando de
 * usuario, y decirlo mal manda a la persona a pedir permisos que ya tiene.
 *
 * QUÉ NO CUBRE
 *
 * `ReassignCase` es la puerta de salida de este estado y por eso no pasa por
 * aquí. La reasignación y la lectura del expediente siguen abiertas: mirar un
 * caso huérfano es precisamente lo que hace falta para decidir a quién dárselo.
 */
export function assertAssigned(kase: Case): void {
  if (kase.assignedTo === null) {
    throw caseNotAssigned(kase.id);
  }
}
