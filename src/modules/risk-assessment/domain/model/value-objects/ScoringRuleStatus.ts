import { invariantViolation } from '../../errors/RiskAssessmentError.js';

export type ScoringRuleStatus = 'ACTIVE' | 'INACTIVE';

const VALID_STATUSES: ReadonlySet<string> = new Set<ScoringRuleStatus>(['ACTIVE', 'INACTIVE']);

export function createScoringRuleStatus(value: string): ScoringRuleStatus {
  if (!VALID_STATUSES.has(value)) {
    throw invariantViolation('ScoringRuleStatus must be one of ACTIVE, INACTIVE', { value });
  }
  return value as ScoringRuleStatus;
}
