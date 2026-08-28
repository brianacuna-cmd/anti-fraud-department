import { invariantViolation } from '../errors/RiskAssessmentError.js';

/** Comparators a factor may use. Closed: an unknown one must fail when typed. */
export const SCORING_OPERATORS = [
  'GT',
  'GTE',
  'LT',
  'LTE',
  'EQ',
  'NEQ',
  'CONTAINS',
  'IN',
  'BETWEEN',
] as const;

export type ScoringOperator = (typeof SCORING_OPERATORS)[number];

export type ScoringValue = string | number | boolean | readonly (string | number)[];

/**
 * One risk factor: a condition on the incoming event and the points it adds
 * when it holds.
 *
 * `points` accepts negatives (down to -100) because lowering risk is as real
 * as raising it — a verified customer or a whitelisted counterparty subtract
 * — and without them that has to be modelled backwards by inflating
 * everything else.
 */
export interface ScoringFactor {
  readonly field: string;
  readonly operator: ScoringOperator;
  readonly value: ScoringValue;
  readonly points: number;
  readonly reason: string;
}

/**
 * Event fields a rule may score on.
 *
 * An allowlist and not a shape check, because `field` ends up inside the
 * graph as the path the engine reads from the context: accepting any string
 * turns a rule into an arbitrary reader of the event, `rawPayload` included —
 * which is exactly what `CalculateRiskScore` strips before evaluating.
 * `createdAt` is deliberately out: it is an `Instant`, and comparing it as a
 * number or a string in a JDM cell produces something that looks like it
 * works and means nothing.
 */
const SCORABLE_FIELDS: ReadonlySet<string> = new Set([
  'provider',
  'providerEventType',
  'caseCustomerId',
  'amountCents',
  'currency',
  'rail',
  'eventId',
  'providerEventId',
  'subjectIdentity.name',
  'subjectIdentity.document',
  'subjectIdentity.walletAddress',
  'subjectIdentity.entryType',
]);

/** `riskSignals` is an open map each provider fills: any key of its own is fine. */
const RISK_SIGNAL_FIELD = /^riskSignals\.[A-Za-z][A-Za-z0-9]*$/;

export function isScorableField(field: string): boolean {
  return SCORABLE_FIELDS.has(field) || RISK_SIGNAL_FIELD.test(field);
}

/** The fixed fields, so the panel can offer them without duplicating the list. */
export function scorableFields(): readonly string[] {
  return [...SCORABLE_FIELDS];
}

/**
 * Source of the function node that folds the hits into a score.
 *
 * A constant, never a template: if the supervisor's data reached it through
 * interpolation, defining a rule would mean running their code inside the
 * engine. Everything they control travels through the table cells, which are
 * escaped literals.
 *
 * The sum is CLAMPED to [0, 100] rather than rejected, because `RiskScore`
 * does reject out of range: without the clamp, four 30-point factors would
 * fail the whole evaluation — and with it the opening of the case — instead
 * of yielding the maximum, which is what a 120 means.
 */
const SUM_FACTORS_SOURCE = `export const handler = async (input) => {
  const hits = Array.isArray(input) ? input : [];
  const total = hits.reduce((acc, hit) => acc + (Number(hit.points) || 0), 0);
  const bounded = Math.max(0, Math.min(100, Math.round(total)));
  return { riskScore: bounded, hits };
};`;

/**
 * Builds the JDM graph of a weighted-factor scoring rule: a `collect` table
 * that gathers EVERY factor that holds, and a function node that sums and
 * clamps them.
 *
 * `collect` and not `first` is what makes the model additive, and it is also
 * what produces the evidence: each hit lands in `hits`, which
 * `ZenRiskScoringEngine` returns and `scoreToCaseOrchestrator` freezes into
 * the case. An opened case can therefore answer why it was opened, factor by
 * factor, with the points each one contributed.
 *
 * An event that triggers no factor produces `hits: []` and a score of 0 — not
 * a failure. A field the event does not carry does not match either: it adds
 * no points and does not break the evaluation.
 */
export function buildFactorScoringJdm(factors: readonly ScoringFactor[]): Record<string, unknown> {
  assertScorable(factors);

  const fields = distinctFields(factors);
  const inputs = fields.map((field, index) => ({ id: `i${index + 1}`, name: field, field }));

  return {
    contentType: 'application/vnd.gorules.decision',
    nodes: [
      { id: 'input', type: 'inputNode', name: 'Evento', position: { x: 0, y: 0 } },
      {
        id: 'factors',
        type: 'decisionTableNode',
        name: 'Factores de riesgo',
        position: { x: 250, y: 0 },
        content: {
          hitPolicy: 'collect',
          inputs,
          outputs: [
            { id: 'o1', name: 'Puntos', field: 'points' },
            { id: 'o2', name: 'Motivo', field: 'reason' },
          ],
          rules: factors.map((factor, index) => toRow(factor, index, fields)),
        },
      },
      {
        id: 'total',
        type: 'functionNode',
        name: 'Suma acotada',
        position: { x: 550, y: 0 },
        content: { source: SUM_FACTORS_SOURCE },
      },
      { id: 'output', type: 'outputNode', name: 'Puntuación', position: { x: 850, y: 0 } },
    ],
    edges: [
      { id: 'e1', sourceId: 'input', targetId: 'factors' },
      { id: 'e2', sourceId: 'factors', targetId: 'total' },
      { id: 'e3', sourceId: 'total', targetId: 'output' },
    ],
  };
}

function distinctFields(factors: readonly ScoringFactor[]): readonly string[] {
  return [...new Set(factors.map((f) => f.field))];
}

/**
 * One row per factor. Columns that are not its own are left blank, which in a
 * JDM table means "I do not look at this field" — not "this field is empty".
 */
function toRow(
  factor: ScoringFactor,
  index: number,
  fields: readonly string[],
): Record<string, string> {
  const columns = Object.fromEntries(
    fields.map((field, column) => [
      `i${column + 1}`,
      field === factor.field ? conditionCell(factor) : '',
    ]),
  );
  return {
    ...columns,
    _id: `r${index + 1}`,
    o1: String(Math.trunc(factor.points)),
    o2: literal(factor.reason),
  };
}

/** The condition cell, in ZEN's expression language. `$` is the column's value. */
function conditionCell(factor: ScoringFactor): string {
  switch (factor.operator) {
    case 'GT':
      return `> ${numeric(factor)}`;
    case 'GTE':
      return `>= ${numeric(factor)}`;
    case 'LT':
      return `< ${numeric(factor)}`;
    case 'LTE':
      return `<= ${numeric(factor)}`;
    case 'EQ':
      return scalar(factor);
    case 'NEQ':
      return `!= ${scalar(factor)}`;
    case 'CONTAINS':
      return `contains($, ${literal(text(factor))})`;
    case 'IN':
      return list(factor).map(scalarLiteral).join(',');
    case 'BETWEEN':
      return between(factor);
  }
}

function between(factor: ScoringFactor): string {
  const bounds = list(factor);
  const low = bounds[0];
  const high = bounds[1];
  if (bounds.length !== 2 || typeof low !== 'number' || typeof high !== 'number') {
    throw invariantViolation('BETWEEN needs exactly two numeric bounds', {
      field: factor.field,
      value: factor.value,
    });
  }
  if (low > high) {
    throw invariantViolation('BETWEEN lower bound must not exceed the upper bound', {
      field: factor.field,
      value: factor.value,
    });
  }
  return `[${low}..${high}]`;
}

function numeric(factor: ScoringFactor): number {
  if (typeof factor.value !== 'number' || !Number.isFinite(factor.value)) {
    throw invariantViolation(`${factor.operator} needs a numeric value`, {
      field: factor.field,
      value: factor.value,
    });
  }
  return factor.value;
}

function text(factor: ScoringFactor): string {
  if (typeof factor.value !== 'string' || factor.value.length === 0) {
    throw invariantViolation(`${factor.operator} needs a non-empty text value`, {
      field: factor.field,
      value: factor.value,
    });
  }
  return factor.value;
}

function scalar(factor: ScoringFactor): string {
  if (Array.isArray(factor.value)) {
    throw invariantViolation(`${factor.operator} needs a single value, not a list`, {
      field: factor.field,
      value: factor.value,
    });
  }
  return scalarLiteral(factor.value as string | number | boolean);
}

function list(factor: ScoringFactor): readonly (string | number)[] {
  if (!Array.isArray(factor.value) || factor.value.length === 0) {
    throw invariantViolation(`${factor.operator} needs a non-empty list of values`, {
      field: factor.field,
      value: factor.value,
    });
  }
  return factor.value;
}

function scalarLiteral(value: string | number | boolean): string {
  return typeof value === 'string' ? literal(value) : String(value);
}

/**
 * A string as a ZEN cell literal.
 *
 * NOT `JSON.stringify`. The engine's expression language has no backslash
 * escape for quotes: a cell of `"dice \"alto\""` does not error — the row is
 * silently DROPPED, so the factor stops scoring and nothing says why. Verified
 * against the engine.
 *
 * So the wrapping quote is chosen by what the text contains. A value carrying
 * BOTH quote characters cannot be expressed at all, and is rejected here
 * rather than turned into a rule that quietly ignores one of its own rows.
 */
function literal(value: string): string {
  const hasDouble = value.includes('"');
  const hasSingle = value.includes("'");
  if (hasDouble && hasSingle) {
    throw invariantViolation(
      'a value cannot carry both \' and " : the rule engine has no escape for them',
      { value },
    );
  }
  return hasDouble ? `'${value}'` : `"${value}"`;
}

function assertScorable(factors: readonly ScoringFactor[]): void {
  if (factors.length === 0) {
    throw invariantViolation('a scoring rule needs at least one factor', {});
  }
  const unknownField = factors.find((factor) => !isScorableField(factor.field));
  if (unknownField !== undefined) {
    throw invariantViolation('scoring factor field is not scorable', { field: unknownField.field });
  }
  const unbounded = factors.find(
    (factor) => !Number.isInteger(factor.points) || Math.abs(factor.points) > 100,
  );
  if (unbounded !== undefined) {
    throw invariantViolation('scoring factor points must be an integer in [-100, 100]', {
      field: unbounded.field,
      points: unbounded.points,
    });
  }
  const unexplained = factors.find((factor) => factor.reason.trim().length === 0);
  if (unexplained !== undefined) {
    throw invariantViolation('every scoring factor needs a reason', { field: unexplained.field });
  }
}
