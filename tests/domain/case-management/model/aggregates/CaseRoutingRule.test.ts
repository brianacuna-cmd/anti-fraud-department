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
});
