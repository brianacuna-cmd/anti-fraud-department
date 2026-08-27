import {
  createBulkScreeningJobStatus,
  isBulkScreeningJobStatus,
} from '../../../../../src/modules/screening/domain/model/value-objects/BulkScreeningJobStatus.js';
import { ScreeningError } from '../../../../../src/modules/screening/domain/errors/ScreeningError.js';

describe('BulkScreeningJobStatus', () => {
  it('accepts all four valid statuses', () => {
    expect(createBulkScreeningJobStatus('PENDING')).toBe('PENDING');
    expect(createBulkScreeningJobStatus('PROCESSING')).toBe('PROCESSING');
    expect(createBulkScreeningJobStatus('COMPLETED')).toBe('COMPLETED');
    expect(createBulkScreeningJobStatus('FAILED')).toBe('FAILED');
  });

  it('rejects an unknown status string', () => {
    expect(() => createBulkScreeningJobStatus('UNKNOWN')).toThrow(ScreeningError);
  });

  it('isBulkScreeningJobStatus returns true for valid values', () => {
    expect(isBulkScreeningJobStatus('PENDING')).toBe(true);
    expect(isBulkScreeningJobStatus('PROCESSING')).toBe(true);
    expect(isBulkScreeningJobStatus('COMPLETED')).toBe(true);
    expect(isBulkScreeningJobStatus('FAILED')).toBe(true);
  });

  it('isBulkScreeningJobStatus returns false for invalid values', () => {
    expect(isBulkScreeningJobStatus('bad')).toBe(false);
    expect(isBulkScreeningJobStatus('')).toBe(false);
  });
});
