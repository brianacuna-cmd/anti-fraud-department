import { buildPriorityRoutingJdm } from '../../../../src/modules/case-management/domain/services/priorityRoutingJdm.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import { tableOf } from '../../../support/jdm.js';

describe('buildPriorityRoutingJdm', () => {
  it('emits one row per priority, routing users and roles to their own output', () => {
    const graph = buildPriorityRoutingJdm([
      { priority: 'CRITICAL', targetType: 'USER', targetId: 'user-1' },
      { priority: 'LOW', targetType: 'ROLE', targetId: 'ANALYST' },
    ]);

    const table = tableOf(graph);
    expect(table.hitPolicy).toBe('first');
    expect(table.inputs).toEqual([{ id: 'i1', name: 'Prioridad', field: 'priority' }]);
    expect(table.rules).toEqual([
      { _id: 'r1', i1: '"CRITICAL"', o1: '"user-1"', o2: 'null' },
      { _id: 'r2', i1: '"LOW"', o1: 'null', o2: '"ANALYST"' },
    ]);
  });

  it('wires input -> table -> output so ZEN has a path to evaluate', () => {
    const graph = buildPriorityRoutingJdm([
      { priority: 'HIGH', targetType: 'ROLE', targetId: 'SUPERVISOR' },
    ]);

    expect(graph.contentType).toBe('application/vnd.gorules.decision');
    expect(graph.edges).toEqual([
      { id: 'e1', sourceId: 'input', targetId: 'table' },
      { id: 'e2', sourceId: 'table', targetId: 'output' },
    ]);
  });

  /*
   * Las celdas son expresiones: un identificador con comillas que se copiara
   * tal cual dejaría de ser un valor y pasaría a ser sintaxis, y el grafo
   * entero fallaría al compilar —o peor, compilaría significando otra cosa.
   */
  it('escapes quotes in a target id instead of splicing them into the cell', () => {
    const graph = buildPriorityRoutingJdm([
      { priority: 'HIGH', targetType: 'USER', targetId: 'a"b' },
    ]);

    expect(tableOf(graph).rules[0].o1).toBe('"a\\"b"');
  });

  it('rejects an empty mapping', () => {
    expect(() => buildPriorityRoutingJdm([])).toThrow(CaseManagementError);
  });

  it('rejects the same priority assigned twice', () => {
    expect(() =>
      buildPriorityRoutingJdm([
        { priority: 'HIGH', targetType: 'USER', targetId: 'user-1' },
        { priority: 'HIGH', targetType: 'ROLE', targetId: 'ANALYST' },
      ]),
    ).toThrow(CaseManagementError);
  });
});
