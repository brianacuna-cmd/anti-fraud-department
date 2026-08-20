import {
  jdmGraphSchema,
  createRoutingRuleSchema,
} from '../../../src/modules/case-management/infrastructure/adapters/inbound/http/dto/routingRuleSchemas.js';

const VALID_JDM = {
  contentType: 'application/vnd.gorules.decision',
  nodes: [
    {
      id: 'input',
      type: 'inputNode',
      name: 'Request',
      position: { x: 0, y: 0 },
    },
    {
      id: 'expr',
      type: 'expressionNode',
      content: { expressions: [{ key: 'match', value: '1' }] },
    },
  ],
  edges: [{ id: 'e1', sourceId: 'input', targetId: 'expr' }],
};

describe('routingRuleSchemas JDM structural validation', () => {
  it('accepts a structurally valid JDM graph', () => {
    const result = jdmGraphSchema.safeParse(VALID_JDM);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contentType).toBe('application/vnd.gorules.decision');
      expect(result.data.nodes).toHaveLength(2);
      expect(result.data.edges).toHaveLength(1);
    }
  });

  it('rejects a non-object graph', () => {
    expect(jdmGraphSchema.safeParse(null).success).toBe(false);
    expect(jdmGraphSchema.safeParse('not-a-graph').success).toBe(false);
  });

  it('rejects wrong contentType', () => {
    const result = jdmGraphSchema.safeParse({ ...VALID_JDM, contentType: 'text/plain' });

    expect(result.success).toBe(false);
  });

  it('rejects empty nodes array', () => {
    const result = jdmGraphSchema.safeParse({ ...VALID_JDM, nodes: [] });

    expect(result.success).toBe(false);
  });

  it('rejects a node missing id', () => {
    const result = jdmGraphSchema.safeParse({
      ...VALID_JDM,
      nodes: [{ type: 'inputNode' }],
    });

    expect(result.success).toBe(false);
  });

  it('accepts create body with name, conditions, and optional targets', () => {
    const result = createRoutingRuleSchema.safeParse({
      name: 'draft-rule',
      conditions: VALID_JDM,
      conditionsVersion: 2,
      targetUserId: 'user-1',
      targetRoleId: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('draft-rule');
      expect(result.data.conditionsVersion).toBe(2);
      expect(result.data.targetUserId).toBe('user-1');
    }
  });

  it('rejects create body with invalid JDM', () => {
    const result = createRoutingRuleSchema.safeParse({
      name: 'draft-rule',
      conditions: { contentType: 'application/vnd.gorules.decision', nodes: [], edges: [] },
    });

    expect(result.success).toBe(false);
  });
});
