import { CaseRoutingRule } from '../../../../../src/modules/case-management/domain/model/aggregates/CaseRoutingRule.js';
import { generateCaseRoutingRuleId } from '../../../../../src/modules/case-management/domain/model/value-objects/CaseRoutingRuleId.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function create(overrides: Partial<Parameters<typeof CaseRoutingRule.create>[0]> = {}): CaseRoutingRule {
  return CaseRoutingRule.create({
    id: generateCaseRoutingRuleId(),
    organizationId: 'org-1',
    name: 'high-risk',
    conditions: { nodes: [] },
    conditionsVersion: 1,
    now: NOW,
    ...overrides,
  });
}

describe('CaseRoutingRule', () => {
  it('defaults status to INACTIVE and targets to null', () => {
    const rule = create();

    expect(rule.status).toBe('INACTIVE');
    expect(rule.targetUserId).toBeNull();
    expect(rule.targetRoleId).toBeNull();
    expect(rule.conditionsVersion).toBe(1);
  });

  it('retains explicit targets and INACTIVE status', () => {
    const rule = create({ status: 'INACTIVE', targetUserId: 'user-1', targetRoleId: 'role-1' });

    expect(rule.status).toBe('INACTIVE');
    expect(rule.targetUserId).toBe('user-1');
    expect(rule.targetRoleId).toBe('role-1');
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

  it('activate flips INACTIVE to ACTIVE and updates updatedAt', () => {
    const later = fromDate(new Date('2026-02-01T00:00:00.000Z'));
    const rule = create({ status: 'INACTIVE' });

    const activated = rule.activate(later);

    expect(activated.status).toBe('ACTIVE');
    expect(activated.updatedAt).toBe(later);
    expect(rule.status).toBe('INACTIVE');
  });

  it('deactivate flips ACTIVE to INACTIVE and updates updatedAt', () => {
    const later = fromDate(new Date('2026-02-01T00:00:00.000Z'));
    const rule = create({ status: 'ACTIVE' });

    const deactivated = rule.deactivate(later);

    expect(deactivated.status).toBe('INACTIVE');
    expect(deactivated.updatedAt).toBe(later);
    expect(rule.status).toBe('ACTIVE');
  });
});

const LATER = fromDate(new Date('2026-02-01T00:00:00.000Z'));
const NEXT_CONDITIONS = { nodes: [{ id: 'n2', type: 'inputNode' }] };

describe('CaseRoutingRule#update', () => {
  it('bumps conditionsVersion by 1 when conditions JSON changes and persists name', () => {
    const rule = create({ name: 'high-risk', conditions: { nodes: [] }, conditionsVersion: 3 });

    const updated = rule.update({ name: 'renamed', conditions: NEXT_CONDITIONS }, LATER);

    expect(updated.name).toBe('renamed');
    expect(updated.conditions).toEqual(NEXT_CONDITIONS);
    expect(updated.conditionsVersion).toBe(4);
    expect(updated.updatedAt).toBe(LATER);
    expect(updated.status).toBe(rule.status);
    expect(rule.conditionsVersion).toBe(3);
  });

  it('does not bump conditionsVersion on a name-only change', () => {
    const rule = create({ name: 'high-risk', conditionsVersion: 3 });

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

  it('updates targets without bumping conditionsVersion', () => {
    const rule = create({ conditionsVersion: 3, targetRoleId: 'role-1', targetUserId: null });

    const updated = rule.update({ targetRoleId: null, targetUserId: 'user-9' }, LATER);

    expect(updated.targetRoleId).toBeNull();
    expect(updated.targetUserId).toBe('user-9');
    expect(updated.conditionsVersion).toBe(3);
  });

  it('rejects status on update and leaves the original unchanged', () => {
    const rule = create({ status: 'ACTIVE' });

    expect(() => rule.update({ status: 'INACTIVE' } as never, LATER)).toThrow(/status/);
    expect(rule.status).toBe('ACTIVE');
  });

  it('rejects an empty name on update', () => {
    const rule = create({ name: 'high-risk' });

    expect(() => rule.update({ name: '  ' }, LATER)).toThrow(/name/);
    expect(rule.name).toBe('high-risk');
  });
});

describe('CaseRoutingRule#withExecutionOrder', () => {
  it('sets executionOrder and updatedAt without bumping conditionsVersion', () => {
    const rule = create({ conditionsVersion: 4, name: 'high-risk', status: 'ACTIVE' });

    const reordered = rule.withExecutionOrder(7, LATER);

    expect(reordered.executionOrder).toBe(7);
    expect(reordered.conditionsVersion).toBe(4);
    expect(reordered.updatedAt).toBe(LATER);
    expect(reordered.name).toBe('high-risk');
    expect(reordered.status).toBe('ACTIVE');
    expect(rule.executionOrder).toBe(0);
    expect(rule.updatedAt).toBe(NOW);
  });

  it('accepts 0 and rejects a negative executionOrder without mutating the original', () => {
    const rule = create();

    expect(rule.withExecutionOrder(0, LATER).executionOrder).toBe(0);
    expect(() => rule.withExecutionOrder(-1, LATER)).toThrow(/executionOrder/);
    expect(rule.executionOrder).toBe(0);
  });
});
