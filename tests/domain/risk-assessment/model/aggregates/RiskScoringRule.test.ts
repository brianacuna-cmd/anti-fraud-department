import { RiskScoringRule } from '../../../../../src/modules/risk-assessment/domain/model/aggregates/RiskScoringRule.js';
import { generateRiskScoringRuleId } from '../../../../../src/modules/risk-assessment/domain/model/value-objects/RiskScoringRuleId.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));

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
  it('defaults status to INACTIVE and has no routing targets', () => {
    const rule = create();

    expect(rule.status).toBe('INACTIVE');
    expect(rule.conditionsVersion).toBe(1);
    expect(rule.organizationId).toBe('org-1');
    expect(rule.name).toBe('high-risk-score');
    expect(rule.conditions).toEqual({ nodes: [] });
    expect(rule.createdAt).toBe(NOW);
    expect(rule.updatedAt).toBe(NOW);
    expect(rule).not.toHaveProperty('targetUserId');
    expect(rule).not.toHaveProperty('targetRoleId');
  });

  it('retains an explicit ACTIVE status', () => {
    const rule = create({ status: 'ACTIVE' });

    expect(rule.status).toBe('ACTIVE');
  });

  it('activate sets status ACTIVE and updates updatedAt', () => {
    const rule = create();

    const activated = rule.activate(LATER);

    expect(activated.status).toBe('ACTIVE');
    expect(activated.updatedAt).toBe(LATER);
    expect(activated.createdAt).toBe(NOW);
    expect(rule.status).toBe('INACTIVE');
  });

  it('deactivate sets status INACTIVE and updates updatedAt', () => {
    const rule = create({ status: 'ACTIVE' });

    const deactivated = rule.deactivate(LATER);

    expect(deactivated.status).toBe('INACTIVE');
    expect(deactivated.updatedAt).toBe(LATER);
    expect(rule.status).toBe('ACTIVE');
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
    const created = create({ status: 'ACTIVE' });
    const rehydrated = RiskScoringRule.rehydrate(created.toProps());

    expect(rehydrated.id).toBe(created.id);
    expect(rehydrated.name).toBe(created.name);
    expect(rehydrated.status).toBe('ACTIVE');
  });

  it('delete sets deletedAt without mutating the original, defaults null on create, and is idempotent', () => {
    const rule = create();
    expect(rule.deletedAt).toBeNull();

    const deleted = rule.delete(LATER);
    expect(deleted.deletedAt).toBe(LATER);
    expect(rule.deletedAt).toBeNull();

    const deletedAgain = deleted.delete(fromDate(new Date('2026-01-03T00:00:00.000Z')));
    expect(deletedAgain).toBe(deleted);
    expect(deletedAgain.deletedAt).toBe(LATER);
  });
});

const NEXT_CONDITIONS = { nodes: [{ id: 'n2' }], edges: [] };

describe('RiskScoringRule#update', () => {
  it('bumps conditionsVersion by 1 when conditions JSON changes and persists name', () => {
    const rule = create({ name: 'high-risk-score', conditions: { nodes: [] }, conditionsVersion: 3 });

    const updated = rule.update({ name: 'renamed', conditions: NEXT_CONDITIONS }, LATER);

    expect(updated.name).toBe('renamed');
    expect(updated.conditions).toEqual(NEXT_CONDITIONS);
    expect(updated.conditionsVersion).toBe(4);
    expect(updated.updatedAt).toBe(LATER);
    expect(updated.status).toBe(rule.status);
    expect(rule.conditionsVersion).toBe(3);
  });

  it('does not bump conditionsVersion on a name-only change', () => {
    const rule = create({ name: 'high-risk-score', conditionsVersion: 3 });

    const updated = rule.update({ name: 'renamed' }, LATER);

    expect(updated.name).toBe('renamed');
    expect(updated.conditionsVersion).toBe(3);
    expect(updated.conditions).toEqual({ nodes: [] });
    expect(updated.updatedAt).toBe(LATER);
  });

  it('does not bump conditionsVersion when conditions JSON is identical', () => {
    const conditions = { nodes: [{ id: 'n1' }], edges: [] };
    const rule = create({ conditions, conditionsVersion: 3 });

    const updated = rule.update({ conditions: { nodes: [{ id: 'n1' }], edges: [] } }, LATER);

    expect(updated.conditionsVersion).toBe(3);
    expect(updated.conditions).toEqual({ nodes: [{ id: 'n1' }], edges: [] });
  });

  it('rejects status on update and leaves the original unchanged', () => {
    const rule = create({ status: 'ACTIVE' });

    expect(() => rule.update({ status: 'INACTIVE' } as never, LATER)).toThrow(/status/);
    expect(rule.status).toBe('ACTIVE');
  });

  it('rejects an empty name on update', () => {
    const rule = create({ name: 'high-risk-score' });

    expect(() => rule.update({ name: '  ' }, LATER)).toThrow(/name/);
    expect(rule.name).toBe('high-risk-score');
  });

  it('keeps ACTIVE status when patching conditions', () => {
    const rule = create({ status: 'ACTIVE', conditionsVersion: 2 });

    const updated = rule.update({ conditions: NEXT_CONDITIONS }, LATER);

    expect(updated.status).toBe('ACTIVE');
    expect(updated.conditionsVersion).toBe(3);
    expect(rule.status).toBe('ACTIVE');
  });
});
