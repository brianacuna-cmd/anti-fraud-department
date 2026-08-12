import { invariantViolation } from '../../errors/CaseManagementError.js';

export type CasePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

const VALID_PRIORITIES: ReadonlySet<string> = new Set<CasePriority>([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);

export function createCasePriority(value: string): CasePriority {
  if (!VALID_PRIORITIES.has(value)) {
    throw invariantViolation('CasePriority must be one of LOW, MEDIUM, HIGH, CRITICAL', {
      value,
    });
  }
  return value as CasePriority;
}
