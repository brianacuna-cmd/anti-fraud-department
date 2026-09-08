import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { RiskScoringRule } from '../domain/model/aggregates/RiskScoringRule.js';
import type { createCreateScoringRuleUseCase } from './CreateScoringRule.js';
import { createScoringOperator, type ScoringOperator } from '../domain/model/value-objects/ScoringOperator.js';
import { invariantViolation } from '../domain/errors/RiskAssessmentError.js';
import { zenExpressionLiteral as expressionLiteral } from '../../../shared/rules/zenExpressionLiteral.js';

export type ScoringFactorValue = string | number | boolean | readonly (string | number)[];

export interface ScoringFactorInput {
  readonly field: string;
  readonly operator: string;
  readonly value: ScoringFactorValue;
  readonly points: number;
  readonly reason: string;
}

export interface CreateFactorScoringRuleInput {
  readonly auth: AuthContext;
  readonly name: string;
  readonly factors: readonly ScoringFactorInput[];
}

export interface CreateFactorScoringRuleDeps {
  /** Reuses the existing draft-create use case: same persistence, same audit row. */
  readonly createScoringRule: ReturnType<typeof createCreateScoringRuleUseCase>;
}

/**
 * `POST /risk-scoring-rules/factor-scoring` — the guided builder: a
 * supervisor lists weighted factors instead of hand-authoring a ZEN/JDM
 * graph. Mirrors `CreatePriorityAssignmentRule.ts` exactly: this use case
 * only SHAPES the `conditions` graph and hands it to the real
 * `createScoringRule` use case, which still owns persistence, audit, and
 * the INACTIVE-draft rule.
 *
 * The generated graph is a `collect` decision table (one row per factor,
 * hitPolicy `collect` so every matching factor contributes independently)
 * folded by an `expressionNode` into an integer `riskScore` — the exact
 * shape `ZenRiskScoringEngine.evaluate()` requires (see
 * `tests/integration/risk-assessment/ZenRiskScoringEngine.test.ts`'s
 * `collectThenExpressionJdm()`, which this mirrors). `points`/`reason`
 * output columns are what the frontend's `readScoringFactors()` reads back
 * to reopen the rule in "simple mode".
 */
export function createCreateFactorScoringRuleUseCase(deps: CreateFactorScoringRuleDeps) {
  return async function createFactorScoringRule(
    input: CreateFactorScoringRuleInput,
  ): Promise<RiskScoringRule> {
    if (input.factors.length === 0) {
      throw invariantViolation('factors must include at least one weighted condition', {
        name: input.name,
      });
    }

    const factors = input.factors.map((factor) => ({
      ...factor,
      operator: createScoringOperator(factor.operator),
    }));

    return deps.createScoringRule({
      auth: input.auth,
      name: input.name,
      conditions: buildFactorScoringJdm(factors),
    });
  };
}

interface ResolvedFactor extends Omit<ScoringFactorInput, 'operator'> {
  readonly operator: ScoringOperator;
}

interface InputColumn {
  readonly id: string;
  readonly name: string;
  /** Absent for CONTAINS columns — those run in ZEN's expression mode. */
  readonly field?: string;
}

/**
 * One `decisionTableNode` (hitPolicy `collect`) + one `expressionNode` fold.
 * Exported for direct unit testing of the graph shape.
 */
export function buildFactorScoringJdm(factors: readonly ResolvedFactor[]): Record<string, unknown> {
  const columns = new Map<string, InputColumn>();
  const columnIdFor = (factor: ResolvedFactor): string => {
    const mode = factor.operator === 'CONTAINS' ? 'expr' : 'unary';
    const key = `${factor.field}:${mode}`;
    const existing = columns.get(key);
    if (existing) return existing.id;
    const id = `i${columns.size + 1}`;
    columns.set(key, mode === 'expr' ? { id, name: factor.field } : { id, name: factor.field, field: factor.field });
    return id;
  };

  // Resolve every column first: a row must carry an explicit '' wildcard for
  // every OTHER column, not merely omit the key — ZEN's collect table treats
  // a missing key differently from an empty one (verified against the real
  // engine), and dedup means a later factor can introduce a column an
  // earlier row needs to backfill.
  const factorColumnIds = factors.map((factor) => columnIdFor(factor));

  const rules = factors.map((factor, index) => {
    const row: Record<string, string> = { _id: `r${index + 1}` };
    for (const id of columns.values()) {
      row[id.id] = '';
    }
    row[factorColumnIds[index]!] = cellExpression(factor);
    row.o1 = String(factor.points);
    row.o2 = expressionLiteral(factor.reason);
    return row;
  });

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
          inputs: [...columns.values()],
          outputs: [
            { id: 'o1', name: 'Points', field: 'points' },
            { id: 'o2', name: 'Reason', field: 'reason' },
          ],
          rules,
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

/**
 * Translates one factor into its ZEN cell. GT/GTE/LT/LTE/EQ/NEQ/IN/BETWEEN
 * use unary field-mode syntax (confirmed against the real
 * `@gorules/zen-engine` — see the ZEN Expression Language "Input
 * Expression" table: `< 36`, `[20..39]`, `"A", "B"`, ...). CONTAINS has no
 * unary form, so its column runs in expression mode instead and the cell is
 * a full boolean expression referencing the field path directly.
 */
function cellExpression(factor: ResolvedFactor): string {
  switch (factor.operator) {
    case 'GT':
      return `> ${scalarLiteral(asScalar(factor))}`;
    case 'GTE':
      return `>= ${scalarLiteral(asScalar(factor))}`;
    case 'LT':
      return `< ${scalarLiteral(asScalar(factor))}`;
    case 'LTE':
      return `<= ${scalarLiteral(asScalar(factor))}`;
    case 'EQ':
      return scalarLiteral(asScalar(factor));
    case 'NEQ':
      return `!= ${scalarLiteral(asScalar(factor))}`;
    case 'IN':
      return asArray(factor)
        .map((item) => scalarLiteral(item))
        .join(', ');
    case 'BETWEEN': {
      const [lo, hi] = asArray(factor);
      if (lo === undefined || hi === undefined) {
        throw invariantViolation('BETWEEN requires a two-element [low, high] value', {
          field: factor.field,
          value: factor.value,
        });
      }
      return `[${scalarLiteral(lo)}..${scalarLiteral(hi)}]`;
    }
    case 'CONTAINS':
      return `contains(${factor.field}, ${scalarLiteral(asScalar(factor))})`;
  }
}

function asScalar(factor: ResolvedFactor): string | number | boolean {
  if (Array.isArray(factor.value)) {
    throw invariantViolation(`operator ${factor.operator} requires a scalar value, not an array`, {
      field: factor.field,
      value: factor.value,
    });
  }
  return factor.value as string | number | boolean;
}

function asArray(factor: ResolvedFactor): readonly (string | number)[] {
  if (!Array.isArray(factor.value)) {
    throw invariantViolation(`operator ${factor.operator} requires an array value`, {
      field: factor.field,
      value: factor.value,
    });
  }
  return factor.value as readonly (string | number)[];
}

/** Bare for numbers/booleans, quoted for strings — matches unary-mode ZEN literal syntax. */
function scalarLiteral(value: string | number | boolean): string {
  if (typeof value === 'string') return expressionLiteral(value);
  return String(value);
}
