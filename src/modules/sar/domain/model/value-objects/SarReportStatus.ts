import { invariantViolation } from '../../errors/SarError.js';

/**
 * `DRAFT` (SAR-001) -> `APPROVED` (SAR-002: reviewed, approved, and locked
 * in one step — `PATCH /sar-reports/:id/approve`). No reverse edge: an
 * approved report is immutable, matching "bloqueo formal del expediente
 * previo al envío oficial".
 */
export type SarReportStatus = 'DRAFT' | 'APPROVED';

const VALID_STATUSES: ReadonlySet<string> = new Set<SarReportStatus>(['DRAFT', 'APPROVED']);

export function createSarReportStatus(value: string): SarReportStatus {
  if (!VALID_STATUSES.has(value)) {
    throw invariantViolation('SarReportStatus must be DRAFT or APPROVED', { value });
  }
  return value as SarReportStatus;
}
