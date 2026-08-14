import { ZenRiskScoringEngine } from '../../../src/modules/risk-assessment/infrastructure/adapters/outbound/zen/ZenRiskScoringEngine.js';

/**
 * Minimal JDM: input → collect table (amountCents / providerRiskScore /
 * providerEventType) → Expression integer riskScore → output. No Decision
 * subgraphs. The adapter must not fold collect arrays; Expression does.
 */
function collectThenExpressionJdm(): Record<string, unknown> {
  return {
    contentType: 'application/vnd.gorules.decision',
    nodes: [
      { id: 'input', type: 'inputNode', name: 'Request', position: { x: 0, y: 0 } },
      {
        id: 'collect',
        type: 'decisionTableNode',
        name: 'ScoringHits',
        position: { x: 200, y: 0 },
        content: {
          hitPolicy: 'collect',
          passThrough: true,
          outputPath: 'hits',
          inputs: [
            { id: 'i1', name: 'Amount', field: 'amountCents' },
            { id: 'i2', name: 'Provider Score', field: 'riskSignals.providerRiskScore' },
            { id: 'i3', name: 'Event Type', field: 'providerEventType' },
          ],
          outputs: [{ id: 'o1', name: 'Points', field: 'points' }],
          rules: [
            { _id: 'r1', i1: '>= 10000', i2: '', i3: '', o1: '20' },
            { _id: 'r2', i1: '', i2: '>= 80', i3: '', o1: '30' },
            { _id: 'r3', i1: '', i2: '', i3: '"CHARGEBACK"', o1: '15' },
          ],
        },
      },
      {
        id: 'fold',
        type: 'expressionNode',
        name: 'FoldScore',
        position: { x: 400, y: 0 },
        content: {
          expressions: [
            { id: 'e1', key: 'riskScore', value: 'sum(map(hits, #.points))' },
            // Re-emit collect evidence — Expression output replaces context otherwise.
            { id: 'e2', key: 'hits', value: 'hits' },
          ],
        },
      },
      { id: 'output', type: 'outputNode', name: 'Response', position: { x: 600, y: 0 } },
    ],
    edges: [
      { id: 'e1', sourceId: 'input', targetId: 'collect' },
      { id: 'e2', sourceId: 'collect', targetId: 'fold' },
      { id: 'e3', sourceId: 'fold', targetId: 'output' },
    ],
  };
}

function collectOnlyJdm(): Record<string, unknown> {
  const graph = collectThenExpressionJdm();
  return {
    ...graph,
    nodes: (graph.nodes as Array<Record<string, unknown>>).filter((node) => node.type !== 'expressionNode'),
    edges: [
      { id: 'e1', sourceId: 'input', targetId: 'collect' },
      { id: 'e2', sourceId: 'collect', targetId: 'output' },
    ],
  };
}

function expressionWithoutScoreJdm(): Record<string, unknown> {
  return {
    contentType: 'application/vnd.gorules.decision',
    nodes: [
      { id: 'input', type: 'inputNode', name: 'Request', position: { x: 0, y: 0 } },
      {
        id: 'expr',
        type: 'expressionNode',
        name: 'NoScore',
        position: { x: 200, y: 0 },
        content: { expressions: [{ id: 'e1', key: 'label', value: '"ok"' }] },
      },
      { id: 'output', type: 'outputNode', name: 'Response', position: { x: 400, y: 0 } },
    ],
    edges: [
      { id: 'e1', sourceId: 'input', targetId: 'expr' },
      { id: 'e2', sourceId: 'expr', targetId: 'output' },
    ],
  };
}

function nonIntegerScoreJdm(): Record<string, unknown> {
  return {
    contentType: 'application/vnd.gorules.decision',
    nodes: [
      { id: 'input', type: 'inputNode', name: 'Request', position: { x: 0, y: 0 } },
      {
        id: 'expr',
        type: 'expressionNode',
        name: 'Fractional',
        position: { x: 200, y: 0 },
        content: { expressions: [{ id: 'e1', key: 'riskScore', value: '50.5' }] },
      },
      { id: 'output', type: 'outputNode', name: 'Response', position: { x: 400, y: 0 } },
    ],
    edges: [
      { id: 'e1', sourceId: 'input', targetId: 'expr' },
      { id: 'e2', sourceId: 'expr', targetId: 'output' },
    ],
  };
}

const HIGH_CHARGEBACK = {
  provider: 'stripe',
  providerEventType: 'CHARGEBACK',
  caseCustomerId: 'cust-1',
  amountCents: 15000,
  currency: 'USD',
  riskSignals: { providerRiskScore: 90 },
};

describe('ZenRiskScoringEngine (real @gorules/zen-engine collect+Expression)', () => {
  let engine: ZenRiskScoringEngine;

  beforeAll(() => {
    engine = new ZenRiskScoringEngine();
  });

  afterAll(() => {
    engine.dispose();
  });

  it('folds collect hits via Expression into an integer riskScore (all three rules)', async () => {
    const result = await engine.evaluate(collectThenExpressionJdm(), HIGH_CHARGEBACK);

    expect(result.riskScore).toBe(65);
    expect(result.hits).toEqual([{ points: 20 }, { points: 30 }, { points: 15 }]);
  });

  it('fixture-locks collect+Expression JDM contract: contentType, collect outputPath, Expression fold', () => {
    const graph = collectThenExpressionJdm();
    const nodes = graph.nodes as Array<Record<string, unknown>>;
    const collect = nodes.find((node) => node.id === 'collect') as {
      content: { hitPolicy: string; outputPath: string };
    };
    const fold = nodes.find((node) => node.id === 'fold') as {
      content: { expressions: Array<{ key: string; value: string }> };
    };

    expect(graph.contentType).toBe('application/vnd.gorules.decision');
    expect(collect.content.hitPolicy).toBe('collect');
    expect(collect.content.outputPath).toBe('hits');
    expect(fold.content.expressions[0]).toMatchObject({
      key: 'riskScore',
      value: 'sum(map(hits, #.points))',
    });
    expect(fold.content.expressions[1]).toMatchObject({
      key: 'hits',
      value: 'hits',
    });
  });

  it('produces a different integer when only the amountCents collect row matches', async () => {
    const result = await engine.evaluate(collectThenExpressionJdm(), {
      ...HIGH_CHARGEBACK,
      providerEventType: 'PAYMENT',
      riskSignals: { providerRiskScore: 10 },
    });

    expect(result.riskScore).toBe(20);
    expect(result.hits).toEqual([{ points: 20 }]);
  });

  it('produces a different integer when only providerEventType collect row matches', async () => {
    const result = await engine.evaluate(collectThenExpressionJdm(), {
      ...HIGH_CHARGEBACK,
      amountCents: 100,
      riskSignals: { providerRiskScore: 10 },
    });

    expect(result.riskScore).toBe(15);
    expect(result.hits).toEqual([{ points: 15 }]);
  });

  it('defaults hits to [] when Expression emits riskScore without a hits array', async () => {
    const result = await engine.evaluate(
      {
        contentType: 'application/vnd.gorules.decision',
        nodes: [
          { id: 'input', type: 'inputNode', name: 'Request', position: { x: 0, y: 0 } },
          {
            id: 'expr',
            type: 'expressionNode',
            name: 'ScoreOnly',
            position: { x: 200, y: 0 },
            content: { expressions: [{ id: 'e1', key: 'riskScore', value: '42' }] },
          },
          { id: 'output', type: 'outputNode', name: 'Response', position: { x: 400, y: 0 } },
        ],
        edges: [
          { id: 'e1', sourceId: 'input', targetId: 'expr' },
          { id: 'e2', sourceId: 'expr', targetId: 'output' },
        ],
      },
      HIGH_CHARGEBACK,
    );

    expect(result).toEqual({ riskScore: 42, hits: [] });
  });

  it('throws when the graph emits a collect array instead of an Expression integer', async () => {
    await expect(engine.evaluate(collectOnlyJdm(), HIGH_CHARGEBACK)).rejects.toThrow(
      /riskScore must be an integer/i,
    );
  });

  it('throws when Expression output omits riskScore', async () => {
    await expect(engine.evaluate(expressionWithoutScoreJdm(), HIGH_CHARGEBACK)).rejects.toThrow(
      /riskScore must be an integer/i,
    );
  });

  it('throws when Expression output is a non-integer', async () => {
    await expect(engine.evaluate(nonIntegerScoreJdm(), HIGH_CHARGEBACK)).rejects.toThrow(
      /riskScore must be an integer/i,
    );
  });
});
