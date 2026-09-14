import { invariantViolation } from '../../errors/CaseManagementError.js';

/**
 * How a case ended, as a closed vocabulary. `Resolution.reason` stays as the
 * free-text justification; this is the value metrics, filters and reports
 * can count on.
 *
 * - FRAUD_CONFIRMED: the fraud was proven and sanctioned.
 * - FALSE_POSITIVE: the alert was wrong; the customer is legitimate.
 * - INSUFFICIENT_EVIDENCE: worked to the end without enough to decide.
 * - DOCUMENTATION_NOT_PROVIDED: the customer never delivered what was asked
 *   while the case sat in PENDING_DOCUMENTATION.
 * - DUPLICATE: another case already covers the same facts.
 */
export type ResolutionOutcome =
  | 'FRAUD_CONFIRMED'
  | 'FALSE_POSITIVE'
  | 'INSUFFICIENT_EVIDENCE'
  | 'DOCUMENTATION_NOT_PROVIDED'
  | 'DUPLICATE';

export const RESOLUTION_OUTCOMES: readonly ResolutionOutcome[] = [
  'FRAUD_CONFIRMED',
  'FALSE_POSITIVE',
  'INSUFFICIENT_EVIDENCE',
  'DOCUMENTATION_NOT_PROVIDED',
  'DUPLICATE',
];

const VALID: ReadonlySet<string> = new Set<string>(RESOLUTION_OUTCOMES);

export function createResolutionOutcome(value: string): ResolutionOutcome {
  if (!VALID.has(value)) {
    throw invariantViolation(`ResolutionOutcome must be one of ${RESOLUTION_OUTCOMES.join(', ')}`, { value });
  }
  return value as ResolutionOutcome;
}
