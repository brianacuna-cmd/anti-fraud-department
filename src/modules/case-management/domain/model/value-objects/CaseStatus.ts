import { invariantViolation } from '../../errors/CaseManagementError.js';

/**
 * Case's own status union (spec: "Case aggregate status lifecycle"):
 * OPEN -> IN_REVIEW -> RESOLVED -> ARCHIVED, plus T6 reopen edges
 * RESOLVED|ARCHIVED -> OPEN|IN_REVIEW. The full edge set lives in
 * `caseStatusTransitions` (services/transitions.ts).
 */
export type CaseStatus = 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'ARCHIVED';

const VALID_STATUSES: ReadonlySet<string> = new Set<CaseStatus>([
  'OPEN',
  'IN_REVIEW',
  'RESOLVED',
  'ARCHIVED',
]);

export function createCaseStatus(value: string): CaseStatus {
  if (!VALID_STATUSES.has(value)) {
    throw invariantViolation('CaseStatus must be one of OPEN, IN_REVIEW, RESOLVED, ARCHIVED', {
      value,
    });
  }
  return value as CaseStatus;
}
