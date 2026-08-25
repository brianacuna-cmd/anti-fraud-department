import {
  submitBulkScreeningJobResponseSchema,
  getBulkScreeningJobResponseSchema,
} from '../../../../src/modules/screening/infrastructure/adapters/inbound/http/dto/bulkScreeningSchemas.js';

describe('submitBulkScreeningJobResponseSchema', () => {
  it('accepts a valid { id } response', () => {
    const result = submitBulkScreeningJobResponseSchema.safeParse({ id: '507f1f77bcf86cd799439011' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('507f1f77bcf86cd799439011');
    }
  });

  it('rejects a missing id', () => {
    const result = submitBulkScreeningJobResponseSchema.safeParse({});

    expect(result.success).toBe(false);
  });
});

describe('getBulkScreeningJobResponseSchema', () => {
  const validJob = {
    id: '507f1f77bcf86cd799439011',
    status: 'PENDING',
    totalRows: 0,
    processedRows: 0,
    errors: '',
  };

  it('accepts a valid job view with required camelCase fields', () => {
    const result = getBulkScreeningJobResponseSchema.safeParse(validJob);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(validJob.id);
      expect(result.data.status).toBe('PENDING');
      expect(result.data.totalRows).toBe(0);
      expect(result.data.processedRows).toBe(0);
      expect(result.data.errors).toBe('');
    }
  });

  it('accepts status PROCESSING, COMPLETED, and FAILED', () => {
    for (const status of ['PROCESSING', 'COMPLETED', 'FAILED'] as const) {
      const result = getBulkScreeningJobResponseSchema.safeParse({ ...validJob, status });
      expect(result.success).toBe(true);
    }
  });

  it('rejects an unknown status value', () => {
    const result = getBulkScreeningJobResponseSchema.safeParse({ ...validJob, status: 'BOGUS' });

    expect(result.success).toBe(false);
  });

  it('rejects when filePath is present (PII field must never appear in response)', () => {
    const result = getBulkScreeningJobResponseSchema.safeParse({
      ...validJob,
      filePath: '/tmp/upload.csv',
    });

    expect(result.success).toBe(false);
  });

  it('rejects when file_path (snake_case) is present', () => {
    const result = getBulkScreeningJobResponseSchema.safeParse({
      ...validJob,
      file_path: '/tmp/upload.csv',
    });

    expect(result.success).toBe(false);
  });

  it('rejects when a required field is missing', () => {
    const { processedRows: _, ...withoutProcessedRows } = validJob;
    const result = getBulkScreeningJobResponseSchema.safeParse(withoutProcessedRows);

    expect(result.success).toBe(false);
  });
});
