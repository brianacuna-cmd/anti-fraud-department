import { ZenRoutingEngine } from '../../../src/modules/case-management/infrastructure/adapters/outbound/zen/ZenRoutingEngine.js';
import { buildPriorityAssignmentJdm } from '../../../src/modules/case-management/application/CreatePriorityAssignmentRule.js';
import { createAssignedTo } from '../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';
import type { CaseRoutingContext } from '../../../src/modules/case-management/domain/ports/RoutingEngine.js';
import { oid } from '../../support/oid.js';

const BASE: Omit<CaseRoutingContext, 'priority'> = { riskScore: 10, status: 'OPEN', tags: [] };

/**
 * Proves the graph `buildPriorityAssignmentJdm` generates is not just
 * structurally valid (see the domain-level shape test) but actually
 * EVALUATES correctly against the real `@gorules/zen-engine` — one row per
 * priority, and a priority with no row produces null targets (so
 * `RouteCase.resolveAssignment` correctly skips the rule instead of
 * falling back to a rule-level default, which this builder always leaves
 * null).
 */
describe('buildPriorityAssignmentJdm (real @gorules/zen-engine)', () => {
  let engine: ZenRoutingEngine;

  beforeAll(() => {
    engine = new ZenRoutingEngine();
  });

  afterAll(() => {
    engine.dispose();
  });

  const graph = buildPriorityAssignmentJdm([
    { priority: 'CRITICAL', target: createAssignedTo('ROLE', 'SUPERVISOR') },
    { priority: 'HIGH', target: createAssignedTo('USER', oid('analyst-1')) },
  ]);

  it('CRITICAL resuelve al rol SUPERVISOR', async () => {
    const result = await engine.evaluate(graph, { ...BASE, priority: 'CRITICAL' });
    expect(result).toEqual({ targetUserId: null, targetRoleId: 'SUPERVISOR' });
  });

  it('HIGH resuelve al usuario analyst-1', async () => {
    const result = await engine.evaluate(graph, { ...BASE, priority: 'HIGH' });
    expect(result).toEqual({ targetUserId: oid('analyst-1'), targetRoleId: null });
  });

  it('una prioridad sin fila (MEDIUM) no resuelve ningún target', async () => {
    const result = await engine.evaluate(graph, { ...BASE, priority: 'MEDIUM' });
    expect(result).toEqual({ targetUserId: null, targetRoleId: null });
  });
});
