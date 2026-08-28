import {
  jdmGraphSchema,
  createRoutingRuleSchema,
  updateRoutingRuleSchema,
  reorderRoutingRulesSchema,
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

describe('updateRoutingRuleSchema', () => {
  it('accepts optional name, conditions, and targets', () => {
    const result = updateRoutingRuleSchema.safeParse({
      name: 'renamed',
      conditions: VALID_JDM,
      targetRoleId: 'role-1',
      targetUserId: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('renamed');
      expect(result.data.conditions).toEqual(VALID_JDM);
      expect(result.data.targetRoleId).toBe('role-1');
      expect(result.data.targetUserId).toBeNull();
    }
  });

  it('accepts a name-only body', () => {
    const result = updateRoutingRuleSchema.safeParse({ name: 'renamed' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('renamed');
      expect(result.data.conditions).toBeUndefined();
    }
  });

  it('rejects invalid JDM when conditions are present', () => {
    const result = updateRoutingRuleSchema.safeParse({
      conditions: { contentType: 'application/vnd.gorules.decision', nodes: [], edges: [] },
    });

    expect(result.success).toBe(false);
  });

  it('rejects status via strict()', () => {
    const result = updateRoutingRuleSchema.safeParse({ name: 'renamed', status: 'INACTIVE' });

    expect(result.success).toBe(false);
  });

  it('rejects executionOrder via strict()', () => {
    const result = updateRoutingRuleSchema.safeParse({ name: 'renamed', executionOrder: 0 });

    expect(result.success).toBe(false);
  });
});

describe('reorderRoutingRulesSchema', () => {
  it('accepts a full ids permutation', () => {
    const ids = ['aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccccccc'];
    const result = reorderRoutingRulesSchema.safeParse({ ids });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ids).toEqual(ids);
    }
  });

  it('accepts an empty ids list for an empty catalog', () => {
    const result = reorderRoutingRulesSchema.safeParse({ ids: [] });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ids).toEqual([]);
    }
  });

  it('rejects a missing ids field and extra keys via strict()', () => {
    expect(reorderRoutingRulesSchema.safeParse({}).success).toBe(false);
    expect(reorderRoutingRulesSchema.safeParse({ ids: ['aaaaaaaaaaaaaaaaaaaaaaaa'], extra: true }).success).toBe(
      false,
    );
  });
});
