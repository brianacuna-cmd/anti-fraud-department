import { invariantViolation } from '../../errors/ScreeningError.js';

export type BulkScreeningJobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

const VALID_STATUSES: ReadonlySet<string> = new Set<BulkScreeningJobStatus>([
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
]);

export function isBulkScreeningJobStatus(value: unknown): value is BulkScreeningJobStatus {
  return typeof value === 'string' && VALID_STATUSES.has(value);
}

export function createBulkScreeningJobStatus(value: string): BulkScreeningJobStatus {
  if (!VALID_STATUSES.has(value)) {
    throw invariantViolation(
      'BulkScreeningJobStatus must be one of PENDING, PROCESSING, COMPLETED, FAILED',
      { value },
    );
  }
  return value as BulkScreeningJobStatus;
}
