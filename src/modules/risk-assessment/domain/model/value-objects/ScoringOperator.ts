import { invariantViolation } from '../../errors/RiskAssessmentError.js';

/** Comparators the factor-scoring builder (`CreateFactorScoringRule.ts`) accepts. */
export type ScoringOperator =
  | 'GT'
  | 'GTE'
  | 'LT'
  | 'LTE'
  | 'EQ'
  | 'NEQ'
  | 'CONTAINS'
  | 'IN'
  | 'BETWEEN';

const VALID_OPERATORS: ReadonlySet<string> = new Set<ScoringOperator>([
  'GT',
  'GTE',
  'LT',
  'LTE',
  'EQ',
  'NEQ',
  'CONTAINS',
  'IN',
  'BETWEEN',
]);

export function createScoringOperator(value: string): ScoringOperator {
  if (!VALID_OPERATORS.has(value)) {
    throw invariantViolation(
      'ScoringOperator must be one of GT, GTE, LT, LTE, EQ, NEQ, CONTAINS, IN, BETWEEN',
      { value },
    );
  }
  return value as ScoringOperator;
}
