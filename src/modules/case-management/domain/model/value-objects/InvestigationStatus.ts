import { invariantViolation } from '../../errors/CaseManagementError.js';

/**
 * Investigation lifecycle: OPEN when created; INVESTIGATING while active deep
 * work is under way; RESOLVED once the network investigation concludes; CLOSED
 * is the findings-based closure (`close()`). OPEN and INVESTIGATING are the
 * "active" statuses; RESOLVED and CLOSED are terminal.
 */
export type InvestigationStatus = 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'CLOSED';

const INVESTIGATION_STATUSES = ['OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED'] as const;

/** Non-terminal statuses surfaced by the org-wide "active investigations" list. */
export const ACTIVE_INVESTIGATION_STATUSES = ['OPEN', 'INVESTIGATING'] as const;

const VALID: ReadonlySet<string> = new Set<InvestigationStatus>(INVESTIGATION_STATUSES);

export function createInvestigationStatus(value: string): InvestigationStatus {
  if (!VALID.has(value)) {
    throw invariantViolation('InvestigationStatus must be one of OPEN, INVESTIGATING, RESOLVED, CLOSED', {
      value,
    });
  }
  return value as InvestigationStatus;
}
