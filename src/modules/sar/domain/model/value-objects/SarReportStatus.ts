import { invariantViolation } from '../../errors/SarError.js';

/**
 * `DRAFT` (SAR-001) -> `APPROVED` (SAR-002: reviewed, approved and locked)
 * -> `FILED` (SAR-004: the regulator acknowledged it).
 *
 * `FILING_REJECTED` exists because a filing that BOUNCED and one that was
 * never sent are otherwise indistinguishable, and only one of the two still
 * owes the regulator a report. It is not terminal: the usual answer to a
 * rejection is to fix the submission and send it again, which lands on
 * `FILED` with the new tracking number.
 *
 * `FILED` IS terminal. Correcting a filed report means an amended report,
 * which is a new filing with its own identifier — not an edit to this one.
 */
export type SarReportStatus = 'DRAFT' | 'APPROVED' | 'FILED' | 'FILING_REJECTED';

const VALID_STATUSES: ReadonlySet<string> = new Set<SarReportStatus>([
  'DRAFT',
  'APPROVED',
  'FILED',
  'FILING_REJECTED',
]);

export function createSarReportStatus(value: string): SarReportStatus {
  if (!VALID_STATUSES.has(value)) {
    throw invariantViolation(
      'SarReportStatus must be DRAFT, APPROVED, FILED or FILING_REJECTED',
      { value },
    );
  }
  return value as SarReportStatus;
}
