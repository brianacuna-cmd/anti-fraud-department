import { RiskScoringRule } from '../../../../../src/modules/risk-assessment/domain/model/aggregates/RiskScoringRule.js';
import { generateRiskScoringRuleId } from '../../../../../src/modules/risk-assessment/domain/model/value-objects/RiskScoringRuleId.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function create(overrides: Partial<Parameters<typeof RiskScoringRule.create>[0]> = {}): RiskScoringRule {
  return RiskScoringRule.create({
    id: generateRiskScoringRuleId(),
    organizationId: 'org-1',
    name: 'high-risk-score',
    conditions: { nodes: [] },
    conditionsVersion: 1,
    now: NOW,
    ...overrides,
  });
}

describe('RiskScoringRule', () => {
  it('defaults status to ACTIVE and has no routing targets', () => {
    const rule = create();

    expect(rule.status).toBe('ACTIVE');
    expect(rule.conditionsVersion).toBe(1);
    expect(rule.organizationId).toBe('org-1');
    expect(rule.name).toBe('high-risk-score');
    expect(rule.conditions).toEqual({ nodes: [] });
    expect(rule.createdAt).toBe(NOW);
    expect(rule.updatedAt).toBe(NOW);
    expect(rule).not.toHaveProperty('targetUserId');
    expect(rule).not.toHaveProperty('targetRoleId');
  });

  it('retains an explicit INACTIVE status', () => {
    const rule = create({ status: 'INACTIVE' });

    expect(rule.status).toBe('INACTIVE');
  });

  it('rejects an empty organizationId', () => {
    expect(() => create({ organizationId: '  ' })).toThrow(/organizationId/);
  });

  it('rejects an empty name', () => {
    expect(() => create({ name: '' })).toThrow(/name/);
  });

  it('rejects a negative conditionsVersion', () => {
    expect(() => create({ conditionsVersion: -1 })).toThrow(/conditionsVersion/);
  });

  it('rehydrates persisted props without re-validating', () => {
    const created = create();
    const rehydrated = RiskScoringRule.rehydrate(created.toProps());

    expect(rehydrated.id).toBe(created.id);
    expect(rehydrated.name).toBe(created.name);
    expect(rehydrated.status).toBe('ACTIVE');
  });
});
