import {
  jdmGraphSchema,
  createScoringRuleSchema,
  updateScoringRuleSchema,
} from '../../../src/modules/risk-assessment/infrastructure/adapters/inbound/http/dto/scoringRuleSchemas.js';
import { toUpdateScoringRuleFields } from '../../../src/modules/risk-assessment/infrastructure/adapters/inbound/http/mappers/ScoringRuleHttpMapper.js';

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
      content: { expressions: [{ key: 'riskScore', value: '1' }] },
    },
  ],
  edges: [{ id: 'e1', sourceId: 'input', targetId: 'expr' }],
};

describe('scoringRuleSchemas JDM structural validation', () => {
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

  it('accepts create body with name and conditions', () => {
    const result = createScoringRuleSchema.safeParse({
      name: 'draft-rule',
      conditions: VALID_JDM,
      conditionsVersion: 2,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('draft-rule');
      expect(result.data.conditionsVersion).toBe(2);
    }
  });

  it('rejects create body with invalid JDM', () => {
    const result = createScoringRuleSchema.safeParse({
      name: 'draft-rule',
      conditions: { contentType: 'application/vnd.gorules.decision', nodes: [], edges: [] },
    });

    expect(result.success).toBe(false);
  });
});

describe('updateScoringRuleSchema', () => {
  it('accepts optional name and conditions together', () => {
    const result = updateScoringRuleSchema.safeParse({
      name: 'renamed',
      conditions: VALID_JDM,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('renamed');
      expect(result.data.conditions).toEqual(VALID_JDM);
    }
  });

  it('accepts a name-only body', () => {
    const result = updateScoringRuleSchema.safeParse({ name: 'renamed' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('renamed');
      expect(result.data.conditions).toBeUndefined();
    }
  });

  it('accepts a conditions-only body', () => {
    const result = updateScoringRuleSchema.safeParse({ conditions: VALID_JDM });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBeUndefined();
      expect(result.data.conditions).toEqual(VALID_JDM);
    }
  });

  it('accepts an empty object for a later silent no-op', () => {
    const result = updateScoringRuleSchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({});
    }
  });

  it('rejects empty name', () => {
    const result = updateScoringRuleSchema.safeParse({ name: '' });

    expect(result.success).toBe(false);
  });

  it('rejects invalid JDM when conditions are present', () => {
    const result = updateScoringRuleSchema.safeParse({
      conditions: { contentType: 'application/vnd.gorules.decision', nodes: [], edges: [] },
    });

    expect(result.success).toBe(false);
  });

  it('rejects status via strict()', () => {
    const result = updateScoringRuleSchema.safeParse({ name: 'renamed', status: 'INACTIVE' });

    expect(result.success).toBe(false);
  });

  it('rejects conditionsVersion via strict()', () => {
    const result = updateScoringRuleSchema.safeParse({ name: 'renamed', conditionsVersion: 4 });

    expect(result.success).toBe(false);
  });

  it('rejects unknown keys via strict()', () => {
    const result = updateScoringRuleSchema.safeParse({ name: 'renamed', extra: true });

    expect(result.success).toBe(false);
  });
});

describe('toUpdateScoringRuleFields', () => {
  it('maps name and conditions from a parsed PATCH body', () => {
    const parsed = updateScoringRuleSchema.parse({
      name: 'renamed',
      conditions: VALID_JDM,
    });

    expect(toUpdateScoringRuleFields(parsed)).toEqual({
      name: 'renamed',
      conditions: VALID_JDM,
    });
  });

  it('maps a name-only body without inventing conditions', () => {
    const parsed = updateScoringRuleSchema.parse({ name: 'renamed' });

    expect(toUpdateScoringRuleFields(parsed)).toEqual({
      name: 'renamed',
      conditions: undefined,
    });
  });

  it('maps an empty body to undefined patch fields', () => {
    const parsed = updateScoringRuleSchema.parse({});

    expect(toUpdateScoringRuleFields(parsed)).toEqual({
      name: undefined,
      conditions: undefined,
    });
  });
});
