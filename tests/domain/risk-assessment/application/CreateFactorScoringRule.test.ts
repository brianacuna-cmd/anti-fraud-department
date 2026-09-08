import { buildFactorScoringJdm } from '../../../../src/modules/risk-assessment/application/CreateFactorScoringRule.js';
import { ZenRiskScoringEngine } from '../../../../src/modules/risk-assessment/infrastructure/adapters/outbound/zen/ZenRiskScoringEngine.js';

/**
 * Runs the REAL `@gorules/zen-engine` (no fake), matching the module's own
 * convention (`ZenRiskScoringEngine.test.ts`, `scoringRuleRouter.test.ts`'s
 * `/simulate` suite): the whole point of this factory is compiling a graph
 * the engine accepts, so a mock would not test anything.
 */
const engine = new ZenRiskScoringEngine();

const BASE_CONTEXT = {
  amountCents: 900000,
  provider: 'stripe',
  narrative: 'possible fraud detected',
};

async function scoreWith(
  factor: Parameters<typeof buildFactorScoringJdm>[0][number],
  context: Record<string, unknown>,
): Promise<number> {
  const graph = buildFactorScoringJdm([factor]);
  const { riskScore } = await engine.evaluate(graph, context);
  return riskScore;
}

describe('buildFactorScoringJdm', () => {
  it.each([
    ['GT', 'amountCents', 500000, { amountCents: 900000 }, { amountCents: 100000 }],
    ['GTE', 'amountCents', 900000, { amountCents: 900000 }, { amountCents: 899999 }],
    ['LT', 'amountCents', 900000, { amountCents: 100000 }, { amountCents: 900000 }],
    ['LTE', 'amountCents', 100000, { amountCents: 100000 }, { amountCents: 100001 }],
    ['EQ', 'provider', 'stripe', { provider: 'stripe' }, { provider: 'bridge' }],
    ['NEQ', 'provider', 'stripe', { provider: 'bridge' }, { provider: 'stripe' }],
  ] as const)(
    '%s: matches and does not match against the real engine',
    async (operator, field, value, matchContext, noMatchContext) => {
      const factor = { field, operator, value, points: 10, reason: 'test' };

      expect(await scoreWith(factor, { ...BASE_CONTEXT, ...matchContext })).toBe(10);
      expect(await scoreWith(factor, { ...BASE_CONTEXT, ...noMatchContext })).toBe(0);
    },
  );

  it('IN matches any listed value and rejects one outside the list', async () => {
    const factor = {
      field: 'provider',
      operator: 'IN' as const,
      value: ['stripe', 'bridge'],
      points: 10,
      reason: 'test',
    };

    expect(await scoreWith(factor, { ...BASE_CONTEXT, provider: 'stripe' })).toBe(10);
    expect(await scoreWith(factor, { ...BASE_CONTEXT, provider: 'coinflow' })).toBe(0);
  });

  it('BETWEEN is inclusive on both ends and rejects outside the range', async () => {
    const factor = {
      field: 'amountCents',
      operator: 'BETWEEN' as const,
      value: [10, 50],
      points: 10,
      reason: 'test',
    };

    expect(await scoreWith(factor, { ...BASE_CONTEXT, amountCents: 10 })).toBe(10);
    expect(await scoreWith(factor, { ...BASE_CONTEXT, amountCents: 50 })).toBe(10);
    expect(await scoreWith(factor, { ...BASE_CONTEXT, amountCents: 51 })).toBe(0);
  });

  it('CONTAINS matches a substring and rejects text without it', async () => {
    const factor = {
      field: 'narrative',
      operator: 'CONTAINS' as const,
      value: 'fraud',
      points: 10,
      reason: 'test',
    };

    expect(await scoreWith(factor, { ...BASE_CONTEXT, narrative: 'possible fraud detected' })).toBe(10);
    expect(await scoreWith(factor, { ...BASE_CONTEXT, narrative: 'all good' })).toBe(0);
  });

  it('sums points across multiple independently-matching factors (collect hit policy)', async () => {
    const graph = buildFactorScoringJdm([
      { field: 'amountCents', operator: 'GT', value: 500000, points: 40, reason: 'High amount' },
      { field: 'provider', operator: 'IN', value: ['stripe', 'bridge'], points: 10, reason: 'Known provider' },
      { field: 'narrative', operator: 'CONTAINS', value: 'fraud', points: 25, reason: 'Flagged narrative' },
    ]);

    const { riskScore, hits } = await engine.evaluate(graph, BASE_CONTEXT);

    expect(riskScore).toBe(75);
    expect(hits).toHaveLength(3);
    expect(hits.map((h: any) => h.reason).sort()).toEqual(
      ['Flagged narrative', 'High amount', 'Known provider'].sort(),
    );
  });

  it('a field reused with different operators gets its own column per mode without cross-contamination', async () => {
    const graph = buildFactorScoringJdm([
      { field: 'amountCents', operator: 'GT', value: 500000, points: 40, reason: 'High' },
      { field: 'amountCents', operator: 'LT', value: 100, points: 5, reason: 'Trivial' },
    ]);

    const { riskScore: high } = await engine.evaluate(graph, { ...BASE_CONTEXT, amountCents: 900000 });
    expect(high).toBe(40);

    const { riskScore: trivial } = await engine.evaluate(graph, { ...BASE_CONTEXT, amountCents: 1 });
    expect(trivial).toBe(5);

    const { riskScore: neither } = await engine.evaluate(graph, { ...BASE_CONTEXT, amountCents: 5000 });
    expect(neither).toBe(0);
  });
});
