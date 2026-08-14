import { invariantViolation } from '../../errors/CaseManagementError.js';

export type AnalystDecisionType = 'FRAUD_CONFIRMED' | 'FALSE_POSITIVE' | 'INCONCLUSIVE';

const VALID: ReadonlySet<string> = new Set<AnalystDecisionType>([
  'FRAUD_CONFIRMED',
  'FALSE_POSITIVE',
  'INCONCLUSIVE',
]);

export function createAnalystDecisionType(value: string): AnalystDecisionType {
  if (!VALID.has(value)) {
    throw invariantViolation(
      'AnalystDecisionType must be one of FRAUD_CONFIRMED, FALSE_POSITIVE, INCONCLUSIVE',
      { value },
    );
  }
  return value as AnalystDecisionType;
}
