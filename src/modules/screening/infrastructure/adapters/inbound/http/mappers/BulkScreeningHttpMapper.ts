import type { BulkScreeningJobView } from '../../../../../application/GetBulkScreeningJob.js';
import type { BulkScreeningJobId } from '../../../../../domain/model/value-objects/BulkScreeningJobId.js';
import type {
  GetBulkScreeningJobResponse,
  SubmitBulkScreeningJobResponse,
} from '../dto/bulkScreeningSchemas.js';

/** Maps the job id returned by Submit to a 202 HTTP response body. */
export function toSubmitBulkScreeningJobResponse(
  jobId: BulkScreeningJobId,
): SubmitBulkScreeningJobResponse {
  return { id: String(jobId) };
}

/**
 * Maps `BulkScreeningJobView` to the GET response. `filePath` is intentionally
 * absent — it is PII-bearing infrastructure and must never leave the server
 * (design D9, RNF-BS-1).
 */
export function toBulkScreeningJobResponse(view: BulkScreeningJobView): GetBulkScreeningJobResponse {
  return {
    id: view.id,
    status: view.status,
    totalRows: view.totalRows,
    processedRows: view.processedRows,
    errors: view.errors,
  };
}
