import { z } from 'zod';

const bulkScreeningJobStatusEnum = z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']);

/** POST /bulk-screening-jobs 202 response: job id only. */
export const submitBulkScreeningJobResponseSchema = z.object({
  id: z.string(),
});

/**
 * GET /bulk-screening-jobs/:id 200 response. Strict so `filePath` / `file_path`
 * are rejected — that PII field must never appear in HTTP responses (design D9,
 * RNF-BS-1).
 */
export const getBulkScreeningJobResponseSchema = z
  .object({
    id: z.string(),
    status: bulkScreeningJobStatusEnum,
    totalRows: z.number().int().min(0),
    processedRows: z.number().int().min(0),
    errors: z.string(),
  })
  .strict();

export type SubmitBulkScreeningJobResponse = z.infer<typeof submitBulkScreeningJobResponseSchema>;
export type GetBulkScreeningJobResponse = z.infer<typeof getBulkScreeningJobResponseSchema>;
