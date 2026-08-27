import { ZenRoutingEngine } from '../../../src/modules/case-management/infrastructure/adapters/outbound/zen/ZenRoutingEngine.js';
import { buildPriorityRoutingJdm } from '../../../src/modules/case-management/domain/services/priorityRoutingJdm.js';
import type { CaseRoutingContext } from '../../../src/modules/case-management/domain/ports/RoutingEngine.js';

/**
 * El atajo de reparto por prioridad contra el motor de verdad. Los tests de
 * dominio comprueban la forma del grafo; este comprueba que ZEN lo entiende y
 * devuelve lo que `RouteCase` sabe leer.
 */
const MAPPING = buildPriorityRoutingJdm([
  { priority: 'LOW', targetType: 'ROLE', targetId: 'ANALYST' },
  { priority: 'HIGH', targetType: 'USER', targetId: 'user-123' },
  { priority: 'CRITICAL', targetType: 'ROLE', targetId: 'SUPERVISOR' },
]);

function context(priority: string): CaseRoutingContext {
  return { riskScore: 90, status: 'OPEN', priority, tags: [] };
}

describe('buildPriorityRoutingJdm evaluated by the real ZenRoutingEngine', () => {
  let engine: ZenRoutingEngine;

  beforeAll(() => {
    engine = new ZenRoutingEngine();
  });

  afterAll(() => {
    engine.dispose();
  });

  it('routes a priority mapped to a person to that user', async () => {
    expect(await engine.evaluate(MAPPING, context('HIGH'))).toEqual({
      targetUserId: 'user-123',
      targetRoleId: null,
    });
  });

  it('routes a priority mapped to a queue to that role', async () => {
    expect(await engine.evaluate(MAPPING, context('CRITICAL'))).toEqual({
      targetUserId: null,
      targetRoleId: 'SUPERVISOR',
    });
  });

  /*
   * Una prioridad sin destino no casa ninguna fila, y ambos destinos nulos es
   * exactamente lo que `RouteCase.resolveAssignment` lee como "esta regla no
   * asigna": cae al destino de la regla —nulo también— y pasa a la siguiente.
   * Eso es lo que significa dejarla en «Sin asignar» en el panel.
   */
  it('assigns nobody for a priority left out of the mapping', async () => {
    expect(await engine.evaluate(MAPPING, context('MEDIUM'))).toEqual({
      targetUserId: null,
      targetRoleId: null,
    });
  });
});
