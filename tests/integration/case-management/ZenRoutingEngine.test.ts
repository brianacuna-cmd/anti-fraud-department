import { ZenRoutingEngine } from '../../../src/modules/case-management/infrastructure/adapters/outbound/zen/ZenRoutingEngine.js';
import type { CaseRoutingContext } from '../../../src/modules/case-management/domain/ports/RoutingEngine.js';

/** Minimal JDM decision table: riskScore > 80 AND status == OPEN -> targetUserId. */
function userRoutingJdm(): Record<string, unknown> {
  return {
    contentType: 'application/vnd.gorules.decision',
    nodes: [
      { id: 'input', type: 'inputNode', name: 'Request', position: { x: 0, y: 0 } },
      {
        id: 'table',
        type: 'decisionTableNode',
        name: 'Routing',
        position: { x: 200, y: 0 },
        content: {
          hitPolicy: 'first',
          inputs: [
            { id: 'i1', name: 'Risk Score', field: 'riskScore' },
            { id: 'i2', name: 'Status', field: 'status' },
          ],
          outputs: [
            { id: 'o1', name: 'Target User', field: 'targetUserId' },
            { id: 'o2', name: 'Target Role', field: 'targetRoleId' },
          ],
          rules: [{ _id: 'r1', i1: '> 80', i2: '"OPEN"', o1: '"user-123"', o2: 'null' }],
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

function roleRoutingJdm(): Record<string, unknown> {
  return {
    contentType: 'application/vnd.gorules.decision',
    nodes: [
      { id: 'input', type: 'inputNode', name: 'Request', position: { x: 0, y: 0 } },
      {
        id: 'table',
        type: 'decisionTableNode',
        name: 'Routing',
        position: { x: 200, y: 0 },
        content: {
          hitPolicy: 'first',
          inputs: [{ id: 'i1', name: 'Risk Score', field: 'riskScore' }],
          outputs: [{ id: 'o1', name: 'Target Role', field: 'targetRoleId' }],
          rules: [{ _id: 'r1', i1: '> 80', o1: '"role-456"' }],
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

const HIGH_OPEN: CaseRoutingContext = { riskScore: 90, status: 'OPEN', priority: 'HIGH', tags: [] };

describe('ZenRoutingEngine (real @gorules/zen-engine)', () => {
  let engine: ZenRoutingEngine;

  beforeAll(() => {
    engine = new ZenRoutingEngine();
  });

  afterAll(() => {
    engine.dispose();
  });

  it('returns the targetUserId when the JDM rule matches', async () => {
    const result = await engine.evaluate(userRoutingJdm(), HIGH_OPEN);

    expect(result).toEqual({ targetUserId: 'user-123', targetRoleId: null });
  });

  it('returns null targets when no JDM rule matches (riskScore below threshold)', async () => {
    const result = await engine.evaluate(userRoutingJdm(), { ...HIGH_OPEN, riskScore: 50 });

    expect(result).toEqual({ targetUserId: null, targetRoleId: null });
  });

  it('returns null targets when a gating input does not match (wrong status)', async () => {
    const result = await engine.evaluate(userRoutingJdm(), { ...HIGH_OPEN, status: 'CLOSED' });

    expect(result).toEqual({ targetUserId: null, targetRoleId: null });
  });

  it('returns the targetRoleId for a role-routing JDM', async () => {
    const result = await engine.evaluate(roleRoutingJdm(), HIGH_OPEN);

    expect(result).toEqual({ targetUserId: null, targetRoleId: 'role-456' });
  });
});
