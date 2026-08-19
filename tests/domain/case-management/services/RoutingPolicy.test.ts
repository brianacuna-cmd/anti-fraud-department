import {
  matchesConditions,
  selectRoutingRule,
  type RoutableCase,
} from '../../../../src/modules/case-management/domain/services/RoutingPolicy.js';
import {
  CaseRoutingRule,
  type RoutingConditions,
} from '../../../../src/modules/case-management/domain/model/aggregates/CaseRoutingRule.js';
import { createCaseRoutingRuleId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseRoutingRuleId.js';
import { createAssignedTo } from '../../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-09-01T00:00:00.000Z'));

const baseCase: RoutableCase = {
  riskScore: 60,
  priority: 'HIGH',
  tags: ['AML'],
  customerEmail: 'cliente@finturu.com',
  stripeCustomerId: null,
  bridgeWallet: 'wallet-1',
};

function rule(
  id: string,
  evaluationOrder: number,
  conditions: RoutingConditions,
  assigneeId = `analyst-${id}`,
  status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
) {
  return CaseRoutingRule.create({
    id: createCaseRoutingRuleId(id),
    organizationId: 'org-1',
    name: `regla-${id}`,
    evaluationOrder,
    conditions,
    assignTo: createAssignedTo('USER', assigneeId),
    status,
    now: NOW,
  });
}

describe('matchesConditions', () => {
  it('matches everything when no condition is declared', () => {
    expect(matchesConditions({}, baseCase)).toBe(true);
  });

  it('applies the risk score range inclusively at both ends', () => {
    expect(matchesConditions({ riskScoreMin: 60 }, baseCase)).toBe(true);
    expect(matchesConditions({ riskScoreMax: 60 }, baseCase)).toBe(true);
    expect(matchesConditions({ riskScoreMin: 61 }, baseCase)).toBe(false);
    expect(matchesConditions({ riskScoreMax: 59 }, baseCase)).toBe(false);
  });

  it('matches a priority from the declared set', () => {
    expect(matchesConditions({ priorities: ['HIGH', 'CRITICAL'] }, baseCase)).toBe(true);
    expect(matchesConditions({ priorities: ['LOW'] }, baseCase)).toBe(false);
  });

  it('requires ALL declared tags, not any of them', () => {
    const kase = { ...baseCase, tags: ['AML', 'SANCTIONS'] };
    expect(matchesConditions({ tags: ['AML', 'SANCTIONS'] }, kase)).toBe(true);
    // Con "alguna" bastaria y la regla capturaria casos que su autor no pretendia.
    expect(matchesConditions({ tags: ['AML', 'CHARGEBACK'] }, kase)).toBe(false);
  });

  it('compares the email domain case-insensitively and tolerates a leading @', () => {
    const kase = { ...baseCase, customerEmail: 'Cliente@Finturu.COM' };
    expect(matchesConditions({ customerEmailDomain: 'finturu.com' }, kase)).toBe(true);
    expect(matchesConditions({ customerEmailDomain: '@FINTURU.com' }, kase)).toBe(true);
    expect(matchesConditions({ customerEmailDomain: 'otro.com' }, kase)).toBe(false);
  });

  it('does not match a domain condition when the customer has no email', () => {
    expect(matchesConditions({ customerEmailDomain: 'finturu.com' }, { ...baseCase, customerEmail: null })).toBe(
      false,
    );
  });

  it('treats presence flags as booleans, both ways', () => {
    expect(matchesConditions({ hasStripeCustomer: false }, baseCase)).toBe(true);
    expect(matchesConditions({ hasStripeCustomer: true }, baseCase)).toBe(false);
    expect(matchesConditions({ hasBridgeWallet: true }, baseCase)).toBe(true);
  });

  it('requires every declared condition at once', () => {
    expect(matchesConditions({ riskScoreMin: 50, priorities: ['HIGH'] }, baseCase)).toBe(true);
    expect(matchesConditions({ riskScoreMin: 50, priorities: ['LOW'] }, baseCase)).toBe(false);
  });
});

describe('selectRoutingRule', () => {
  it('returns null when no rule matches', () => {
    expect(selectRoutingRule([rule('a', 0, { riskScoreMin: 90 })], baseCase)).toBeNull();
  });

  it('returns the first match in evaluation order, not document order', () => {
    const rules = [
      rule('64b7f1c2e4b0a1d2c3e4f5a3', 30, {}),
      rule('64b7f1c2e4b0a1d2c3e4f5a1', 10, { priorities: ['HIGH'] }),
      rule('64b7f1c2e4b0a1d2c3e4f5a2', 20, {}),
    ];

    expect(selectRoutingRule(rules, baseCase)?.evaluationOrder).toBe(10);
  });

  it('lets a specific rule win over a catch-all placed after it', () => {
    const specific = rule('64b7f1c2e4b0a1d2c3e4f5b1', 1, { riskScoreMin: 50 }, 'especialista');
    const catchAll = rule('64b7f1c2e4b0a1d2c3e4f5b2', 99, {}, 'bandeja');

    expect(selectRoutingRule([catchAll, specific], baseCase)?.assignTo.id).toBe('especialista');
  });

  it('falls through to the catch-all when the specific rule does not match', () => {
    const specific = rule('64b7f1c2e4b0a1d2c3e4f5b1', 1, { riskScoreMin: 95 }, 'especialista');
    const catchAll = rule('64b7f1c2e4b0a1d2c3e4f5b2', 99, {}, 'bandeja');

    expect(selectRoutingRule([specific, catchAll], baseCase)?.assignTo.id).toBe('bandeja');
  });

  it('ignores INACTIVE rules even when they would match first', () => {
    const off = rule('64b7f1c2e4b0a1d2c3e4f5c1', 1, {}, 'apagada', 'INACTIVE');
    const on = rule('64b7f1c2e4b0a1d2c3e4f5c2', 2, {}, 'activa');

    expect(selectRoutingRule([off, on], baseCase)?.assignTo.id).toBe('activa');
  });

  it('breaks an evaluation-order tie deterministically by id', () => {
    const b = rule('64b7f1c2e4b0a1d2c3e4f5d2', 5, {}, 'segunda');
    const a = rule('64b7f1c2e4b0a1d2c3e4f5d1', 5, {}, 'primera');

    // Mismo resultado con independencia del orden en que llegaran de la base.
    expect(selectRoutingRule([b, a], baseCase)?.assignTo.id).toBe('primera');
    expect(selectRoutingRule([a, b], baseCase)?.assignTo.id).toBe('primera');
  });
});

describe('CaseRoutingRule.create', () => {
  it('rejects an impossible risk range instead of silently never matching', () => {
    expect(() =>
      rule('64b7f1c2e4b0a1d2c3e4f5e1', 0, { riskScoreMin: 80, riskScoreMax: 20 }),
    ).toThrow(CaseManagementError);
  });

  it('rejects a score outside 0..100', () => {
    expect(() => rule('64b7f1c2e4b0a1d2c3e4f5e2', 0, { riskScoreMin: 120 })).toThrow(CaseManagementError);
  });

  it('rejects a blank name and a negative evaluation order', () => {
    expect(() =>
      CaseRoutingRule.create({
        id: createCaseRoutingRuleId('64b7f1c2e4b0a1d2c3e4f5e3'),
        organizationId: 'org-1',
        name: '   ',
        evaluationOrder: 0,
        conditions: {},
        assignTo: createAssignedTo('USER', 'analyst-1'),
        now: NOW,
      }),
    ).toThrow(CaseManagementError);

    expect(() => rule('64b7f1c2e4b0a1d2c3e4f5e4', -1, {})).toThrow(CaseManagementError);
  });
});
