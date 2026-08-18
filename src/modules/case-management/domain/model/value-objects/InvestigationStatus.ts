import { invariantViolation } from '../../errors/CaseManagementError.js';

/** Investigation lifecycle: OPEN when created, CLOSED once findings are recorded. */
export type InvestigationStatus = 'OPEN' | 'CLOSED';

export const INVESTIGATION_STATUSES = ['OPEN', 'CLOSED'] as const;

const VALID: ReadonlySet<string> = new Set<InvestigationStatus>(INVESTIGATION_STATUSES);

export function createInvestigationStatus(value: string): InvestigationStatus {
  if (!VALID.has(value)) {
    throw invariantViolation('InvestigationStatus must be OPEN or CLOSED', { value });
  }
  return value as InvestigationStatus;
}
