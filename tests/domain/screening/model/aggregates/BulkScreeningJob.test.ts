import { BulkScreeningJob } from '../../../../../src/modules/screening/domain/model/aggregates/BulkScreeningJob.js';
import { generateBulkScreeningJobId } from '../../../../../src/modules/screening/domain/model/value-objects/BulkScreeningJobId.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';
import { ScreeningError } from '../../../../../src/modules/screening/domain/errors/ScreeningError.js';
import { oid } from '../../../../support/oid.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));

function buildJob(): BulkScreeningJob {
  return BulkScreeningJob.create({
    id: generateBulkScreeningJobId(),
    organizationId: oid('org-1'),
    filePath: '/tmp/bulk-screening/file.csv',
    totalRows: 100,
    createdBy: oid('user-1'),
    now: NOW,
  });
}

describe('BulkScreeningJob', () => {
  describe('create', () => {
    it('creates a PENDING job with correct initial state', () => {
      const job = buildJob();
      expect(job.status).toBe('PENDING');
      expect(job.processedRows).toBe(0);
      expect(job.errors).toBe('');
      expect(job.totalRows).toBe(100);
    });

    it('stores organizationId and filePath', () => {
      const job = buildJob();
      expect(job.organizationId).toBe(oid('org-1'));
      expect(job.filePath).toBe('/tmp/bulk-screening/file.csv');
      expect(job.createdBy).toBe(oid('user-1'));
    });
  });

  describe('startProcessing', () => {
    it('transitions from PENDING to PROCESSING', () => {
      const job = buildJob().startProcessing(LATER);
      expect(job.status).toBe('PROCESSING');
      expect(job.updatedAt).toBe(LATER);
    });

    it('throws INVALID_TRANSITION when not PENDING', () => {
      const job = buildJob().startProcessing(NOW);
      expect(() => job.startProcessing(NOW)).toThrow(ScreeningError);
    });
  });

  describe('complete', () => {
    it('transitions from PROCESSING to COMPLETED', () => {
      const job = buildJob().startProcessing(NOW).complete(LATER);
      expect(job.status).toBe('COMPLETED');
      expect(job.updatedAt).toBe(LATER);
    });

    it('throws INVALID_TRANSITION when not PROCESSING', () => {
      const pendingJob = buildJob();
      expect(() => pendingJob.complete(NOW)).toThrow(ScreeningError);
    });
  });

  describe('fail', () => {
    it('transitions from PROCESSING to FAILED', () => {
      const job = buildJob().startProcessing(NOW).fail(LATER);
      expect(job.status).toBe('FAILED');
      expect(job.updatedAt).toBe(LATER);
    });

    it('throws INVALID_TRANSITION when not PROCESSING', () => {
      const pendingJob = buildJob();
      expect(() => pendingJob.fail(NOW)).toThrow(ScreeningError);
    });
  });

  describe('appendError', () => {
    it('appends first error message', () => {
      const job = buildJob().appendError('Row 1: invalid wallet format');
      expect(job.errors).toBe('Row 1: invalid wallet format');
    });

    it('accumulates multiple messages with newline separator', () => {
      const job = buildJob()
        .appendError('Row 1: invalid wallet format')
        .appendError('Row 5: missing customer_id');
      expect(job.errors).toBe('Row 1: invalid wallet format\nRow 5: missing customer_id');
    });

    it('caps at 16384 characters and appends truncation marker with N=1', () => {
      const bigMsg = 'x'.repeat(16_384);
      const job = buildJob().appendError(bigMsg).appendError('overflow');
      expect(job.errors).toContain('... 1 more errors');
      expect(job.errors.startsWith(bigMsg)).toBe(true);
    });

    it('increments omitted count on subsequent overflows', () => {
      const bigMsg = 'x'.repeat(16_384);
      const job = buildJob()
        .appendError(bigMsg)
        .appendError('overflow-1')
        .appendError('overflow-2');
      expect(job.errors).toContain('... 2 more errors');
      expect(job.errors).not.toContain('... 1 more errors');
    });
  });

  describe('rehydrate', () => {
    it('reconstructs from props without business-rule validation', () => {
      const original = buildJob().startProcessing(NOW).complete(LATER);
      const props = original.toProps();
      const rehydrated = BulkScreeningJob.rehydrate(props);
      expect(rehydrated.status).toBe('COMPLETED');
      expect(rehydrated.id).toBe(original.id);
    });
  });
});
