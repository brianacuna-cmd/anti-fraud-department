import { enrichCollectHitOutputs } from '../../../src/modules/risk-assessment/infrastructure/adapters/outbound/zen/enrichCollectHitOutputs.js';

type JdmNode = Record<string, unknown>;
type CollectContent = {
  hitPolicy: string;
  passThrough?: boolean;
  outputPath?: string;
  inputs: Array<Record<string, unknown>>;
  outputs: Array<Record<string, unknown>>;
  rules: Array<Record<string, unknown>>;
};

const AMOUNT_INPUT = { id: 'i1', name: 'Amount', field: 'amountCents' };
const PROVIDER_INPUT = { id: 'i2', name: 'Provider Score', field: 'riskSignals.providerRiskScore' };
const EVENT_INPUT = { id: 'i3', name: 'Event Type', field: 'providerEventType' };
const POINTS_OUTPUT = { id: 'o1', name: 'Points', field: 'points' };

function collectGraph(contentOverrides: Partial<CollectContent> = {}, nodeName = 'ScoringHits'): Record<string, unknown> {
  return {
    contentType: 'application/vnd.gorules.decision',
    nodes: [
      { id: 'input', type: 'inputNode', name: 'Request', position: { x: 0, y: 0 } },
      {
        id: 'collect',
        type: 'decisionTableNode',
        name: nodeName,
        position: { x: 200, y: 0 },
        content: {
          hitPolicy: 'collect',
          passThrough: true,
          outputPath: 'hits',
          inputs: [AMOUNT_INPUT, PROVIDER_INPUT, EVENT_INPUT],
          outputs: [POINTS_OUTPUT],
          rules: [{ _id: 'r1', i1: '>= 10000', i2: '', i3: '', o1: '20' }],
          ...contentOverrides,
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
            { id: 'e2', key: 'hits', value: 'hits' },
          ],
        },
      },
    ],
    edges: [{ id: 'e1', sourceId: 'input', targetId: 'collect' }],
  };
}

function collectNode(graph: Record<string, unknown>): JdmNode {
  const nodes = graph.nodes as JdmNode[];
  const node = nodes.find((candidate) => candidate.id === 'collect');
  if (node === undefined) {
    throw new Error('expected collect node');
  }
  return node;
}

function collectContent(graph: Record<string, unknown>): CollectContent {
  return collectNode(graph).content as CollectContent;
}

function outputByField(outputs: Array<Record<string, unknown>>, field: string): Record<string, unknown> | undefined {
  return outputs.find((column) => column.field === field);
}

function cellForField(content: CollectContent, rule: Record<string, unknown>, field: string): unknown {
  const column = outputByField(content.outputs, field);
  if (column === undefined) {
    return undefined;
  }
  return rule[column.id as string];
}

describe('enrichCollectHitOutputs', () => {
  it('leaves hitPolicy first tables equal to the input', () => {
    const graph = {
      nodes: [
        {
          id: 'route',
          type: 'decisionTableNode',
          name: 'Routing',
          content: {
            hitPolicy: 'first',
            inputs: [AMOUNT_INPUT],
            outputs: [POINTS_OUTPUT],
            rules: [{ _id: 'r1', i1: '>= 1', o1: '20' }],
          },
        },
      ],
    };

    expect(enrichCollectHitOutputs(graph)).toEqual(graph);
  });

  it('does not overwrite author because, id, or name cells and does not duplicate field columns', () => {
    const graph = collectGraph({
      outputs: [
        POINTS_OUTPUT,
        { id: 'o_id', name: 'id', field: 'id' },
        { id: 'o_name', name: 'name', field: 'name' },
        { id: 'o_because', name: 'because', field: 'because' },
      ],
      rules: [
        {
          _id: 'r1',
          i1: '>= 10000',
          i2: '',
          i3: '',
          o1: '20',
          o_id: '"author-id"',
          o_name: '"author-name"',
          o_because: '"author because"',
        },
      ],
    });

    const enriched = enrichCollectHitOutputs(graph);
    const content = collectContent(enriched);
    const rule = content.rules[0];

    expect(rule.o_id).toBe('"author-id"');
    expect(rule.o_name).toBe('"author-name"');
    expect(rule.o_because).toBe('"author because"');
    expect(content.outputs.filter((column) => column.field === 'id')).toHaveLength(1);
    expect(content.outputs.filter((column) => column.field === 'name')).toHaveLength(1);
    expect(content.outputs.filter((column) => column.field === 'because')).toHaveLength(1);
    expect(outputByField(content.outputs, 'id')).toEqual({ id: 'o_id', name: 'id', field: 'id' });
    expect(outputByField(content.outputs, 'name')).toEqual({ id: 'o_name', name: 'name', field: 'name' });
    expect(outputByField(content.outputs, 'because')).toEqual({
      id: 'o_because',
      name: 'because',
      field: 'because',
    });
  });

  it('omits the id cell when _id is missing and still derives name and because', () => {
    const graph = collectGraph({
      rules: [{ i1: '>= 10000', i2: '', i3: '', o1: '20' }],
    });

    const enriched = enrichCollectHitOutputs(graph);
    const content = collectContent(enriched);
    const rule = content.rules[0];

    expect(outputByField(content.outputs, 'id')).toBeDefined();
    expect(cellForField(content, rule, 'id')).toBeUndefined();
    expect(cellForField(content, rule, 'name')).toBe(JSON.stringify('Amount'));
    expect(cellForField(content, rule, 'because')).toBe(JSON.stringify('Amount >= 10000'));
  });

  it('sets because to the _id only when every input cell is empty', () => {
    const graph = collectGraph({
      rules: [{ _id: 'r-empty', i1: '', i2: '   ', i3: undefined, o1: '20' }],
    });

    const enriched = enrichCollectHitOutputs(graph);
    const content = collectContent(enriched);

    expect(cellForField(content, content.rules[0], 'because')).toBe(JSON.stringify('r-empty'));
  });

  it('keeps distinct because values for collect rows that share the same points', () => {
    const graph = collectGraph({
      rules: [
        { _id: 'r1', i1: '>= 10000', i2: '', i3: '', o1: '20' },
        { _id: 'r2', i1: '', i2: '>= 80', i3: '', o1: '20' },
      ],
    });

    const enriched = enrichCollectHitOutputs(graph);
    const content = collectContent(enriched);

    expect(cellForField(content, content.rules[0], 'because')).toBe(JSON.stringify('r1: Amount >= 10000'));
    expect(cellForField(content, content.rules[1], 'because')).toBe(JSON.stringify('r2: Provider Score >= 80'));
    expect(content.rules[0].o1).toBe('20');
    expect(content.rules[1].o1).toBe('20');
  });

  it('returns the original reference and does not throw for nodes:null, content:1, or a non-object graph', () => {
    const nodesNull = { nodes: null };
    const contentOne = {
      nodes: [{ id: 'collect', type: 'decisionTableNode', content: 1 }],
    };
    const nonObject = 1 as unknown as Record<string, unknown>;

    expect(() => enrichCollectHitOutputs(nodesNull)).not.toThrow();
    expect(enrichCollectHitOutputs(nodesNull)).toBe(nodesNull);

    expect(() => enrichCollectHitOutputs(contentOne)).not.toThrow();
    expect(enrichCollectHitOutputs(contentOne)).toBe(contentOne);

    expect(() => enrichCollectHitOutputs(nonObject)).not.toThrow();
    expect(enrichCollectHitOutputs(nonObject)).toBe(nonObject);
  });

  it('does not mutate the caller graph identity or deep value', () => {
    const graph = collectGraph({
      rules: [
        { _id: 'r1', i1: '>= 10000', i2: '', i3: '', o1: '20' },
        { _id: 'r2', i1: '', i2: '>= 80', i3: '', o1: '30' },
        { _id: 'r3', i1: '', i2: '', i3: '"CHARGEBACK"', o1: '15' },
      ],
    });
    const snapshot = structuredClone(graph);

    const enriched = enrichCollectHitOutputs(graph);

    expect(graph).toEqual(snapshot);
    expect(enriched).not.toBe(graph);
    expect(collectContent(graph).outputs).toEqual([POINTS_OUTPUT]);
    expect(collectContent(graph).rules[0]).toEqual({
      _id: 'r1',
      i1: '>= 10000',
      i2: '',
      i3: '',
      o1: '20',
    });
  });

  it('writes id, name, and because cells as ZEN string literals including >= and quotes', () => {
    const graph = collectGraph({
      rules: [
        { _id: 'r1', i1: '>= 10000', i2: '', i3: '', o1: '20' },
        { _id: 'r2', i1: '', i2: '>= 80', i3: '', o1: '30' },
        { _id: 'r3', i1: '', i2: '', i3: '"CHARGEBACK"', o1: '15' },
      ],
    });

    const enriched = enrichCollectHitOutputs(graph);
    const content = collectContent(enriched);
    const fold = (enriched.nodes as JdmNode[]).find((node) => node.id === 'fold') as {
      content: { expressions: Array<{ key: string; value: string }> };
    };

    expect(cellForField(content, content.rules[0], 'id')).toBe(JSON.stringify('r1'));
    expect(cellForField(content, content.rules[0], 'name')).toBe(JSON.stringify('Amount'));
    expect(cellForField(content, content.rules[0], 'because')).toBe(JSON.stringify('r1: Amount >= 10000'));

    expect(cellForField(content, content.rules[1], 'id')).toBe(JSON.stringify('r2'));
    expect(cellForField(content, content.rules[1], 'name')).toBe(JSON.stringify('Provider Score'));
    expect(cellForField(content, content.rules[1], 'because')).toBe(JSON.stringify('r2: Provider Score >= 80'));

    expect(cellForField(content, content.rules[2], 'id')).toBe(JSON.stringify('r3'));
    expect(cellForField(content, content.rules[2], 'name')).toBe(JSON.stringify('Event Type'));
    expect(cellForField(content, content.rules[2], 'because')).toBe(
      `'r3: Event Type "CHARGEBACK"'`,
    );

    expect(content.rules[0].o1).toBe('20');
    expect(content.rules[1].o1).toBe('30');
    expect(content.rules[2].o1).toBe('15');
    expect(fold.content.expressions[0]).toEqual({
      id: 'e1',
      key: 'riskScore',
      value: 'sum(map(hits, #.points))',
    });
    expect(outputByField(content.outputs, 'id')?.id).toBe('o_id');
    expect(outputByField(content.outputs, 'name')?.id).toBe('o_name');
    expect(outputByField(content.outputs, 'because')?.id).toBe('o_because');
  });

  it('uses a numeric suffix when o_id / o_name / o_because are already taken by other columns', () => {
    const graph = collectGraph({
      outputs: [
        { id: 'o_id', name: 'Points', field: 'points' },
        { id: 'o_name', name: 'Alt', field: 'alt' },
        { id: 'o_because', name: 'Extra', field: 'extra' },
      ],
      rules: [{ _id: 'r1', i1: '>= 10000', i2: '', i3: '', o_id: '20' }],
    });

    const enriched = enrichCollectHitOutputs(graph);
    const content = collectContent(enriched);
    const idColumn = outputByField(content.outputs, 'id');
    const nameColumn = outputByField(content.outputs, 'name');
    const becauseColumn = outputByField(content.outputs, 'because');

    expect(idColumn?.id).toMatch(/^o_id\d+$/);
    expect(nameColumn?.id).toMatch(/^o_name\d+$/);
    expect(becauseColumn?.id).toMatch(/^o_because\d+$/);
    expect(content.outputs.filter((column) => column.field === 'points')).toHaveLength(1);
    expect(content.rules[0][idColumn!.id as string]).toBe(JSON.stringify('r1'));
    expect(content.rules[0].o_id).toBe('20');
  });

  it('falls back to the collect node name when _id and input names are unavailable', () => {
    const graph = collectGraph(
      {
        inputs: [{ id: 'i1', name: '', field: 'amountCents' }],
        rules: [{ i1: '>= 1', o1: '5' }],
      },
      'FallbackNode',
    );

    const enriched = enrichCollectHitOutputs(graph);
    const content = collectContent(enriched);

    expect(cellForField(content, content.rules[0], 'name')).toBe(JSON.stringify('FallbackNode'));
    expect(cellForField(content, content.rules[0], 'because')).toBe(JSON.stringify(' >= 1'));
  });
});
