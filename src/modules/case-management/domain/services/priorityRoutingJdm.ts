import { invariantViolation } from '../errors/CaseManagementError.js';
import type { CasePriority } from '../model/value-objects/CasePriority.js';

/** Una prioridad y quién se lleva los casos que la lleven. */
export interface PriorityAssignment {
  readonly priority: CasePriority;
  readonly targetType: 'USER' | 'ROLE';
  readonly targetId: string;
}

/**
 * Construye el grafo JDM de una asignación por prioridad: una tabla de
 * decisión con una fila por prioridad y dos salidas, `targetUserId` y
 * `targetRoleId`, que es lo que `ZenRoutingEngine` lee.
 *
 * Vive en el dominio y no en el cliente porque la forma del grafo ES la regla:
 * qué campo se mira, con qué política de acierto y qué salidas produce son
 * decisiones de `RouteCase`, no de la pantalla que las pide. Un frontend que
 * arma grafos JDM obliga a versionar el motor en dos sitios.
 *
 * `hitPolicy: 'first'` con igualdad exacta sobre `priority` hace irrelevante el
 * orden de las filas. Una prioridad que no aparece no casa ninguna fila: ZEN
 * devuelve ambas salidas nulas y `RouteCase` pasa a la regla siguiente, que es
 * justo lo que significa dejarla sin asignar.
 */
export function buildPriorityRoutingJdm(
  assignments: readonly PriorityAssignment[],
): Record<string, unknown> {
  assertAssignable(assignments);

  return {
    contentType: 'application/vnd.gorules.decision',
    nodes: [
      { id: 'input', type: 'inputNode', name: 'Request', position: { x: 0, y: 0 } },
      {
        id: 'table',
        type: 'decisionTableNode',
        name: 'Asignación por prioridad',
        position: { x: 200, y: 0 },
        content: {
          hitPolicy: 'first',
          inputs: [{ id: 'i1', name: 'Prioridad', field: 'priority' }],
          outputs: [
            { id: 'o1', name: 'Usuario', field: 'targetUserId' },
            { id: 'o2', name: 'Rol', field: 'targetRoleId' },
          ],
          rules: assignments.map(toRow),
        },
      },
      { id: 'output', type: 'outputNode', name: 'Response', position: { x: 400, y: 0 } },
    ],
    edges: [
      { id: 'e1', sourceId: 'input', targetId: 'table' },
      { id: 'e2', sourceId: 'table', targetId: 'output' },
    ],
  };
}

function toRow(assignment: PriorityAssignment, index: number): Record<string, string> {
  const isUser = assignment.targetType === 'USER';
  return {
    _id: `r${index + 1}`,
    i1: literal(assignment.priority),
    o1: isUser ? literal(assignment.targetId) : 'null',
    o2: isUser ? 'null' : literal(assignment.targetId),
  };
}

/**
 * Las celdas de una tabla JDM son EXPRESIONES, no datos: una comilla sin
 * escapar dentro de un identificador deja de ser un valor y pasa a ser
 * sintaxis. `JSON.stringify` produce el literal entrecomillado y escapado, que
 * es la única forma segura de meter texto ajeno en una celda.
 */
function literal(value: string): string {
  return JSON.stringify(value);
}

function assertAssignable(assignments: readonly PriorityAssignment[]): void {
  if (assignments.length === 0) {
    throw invariantViolation('priority mapping needs at least one assignment', {});
  }
  const priorities = assignments.map((a) => a.priority);
  const repeated = priorities.find((priority, index) => priorities.indexOf(priority) !== index);
  if (repeated !== undefined) {
    throw invariantViolation('priority mapping must not assign the same priority twice', {
      priority: repeated,
    });
  }
}
