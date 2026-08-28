import { invariantViolation } from '../../errors/SarError.js';

/**
 * Closed for now — every report SAR-001 creates is a draft. SAR-002 will add
 * `IN_REVIEW`/`APPROVED`/`LOCKED` as the review/lock workflow lands.
 */
export type SarReportStatus = 'DRAFT';

const VALID_STATUSES: ReadonlySet<string> = new Set<SarReportStatus>(['DRAFT']);

export function createSarReportStatus(value: string): SarReportStatus {
  if (!VALID_STATUSES.has(value)) {
    throw invariantViolation('SarReportStatus must be DRAFT', { value });
  }
  return value as SarReportStatus;
}
