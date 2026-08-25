import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { BulkScreeningJobStatus } from '../domain/model/value-objects/BulkScreeningJobStatus.js';
import type { BulkScreeningJobRepository } from '../domain/ports/BulkScreeningJobRepository.js';
import { createBulkScreeningJobId } from '../domain/model/value-objects/BulkScreeningJobId.js';
import { bulkScreeningJobNotFound } from '../domain/errors/ScreeningError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface GetBulkScreeningJobInput {
  readonly auth: AuthContext;
  readonly jobId: string;
}

/**
 * View returned by the GET endpoint. `filePath` is intentionally absent —
 * it is internal PII-bearing infrastructure and must never leave the server
 * (design D9, RNF-BS-1).
 */
export interface BulkScreeningJobView {
  readonly id: string;
  readonly status: BulkScreeningJobStatus;
  readonly totalRows: number;
  readonly processedRows: number;
  readonly errors: string;
}

export interface GetBulkScreeningJobDeps {
  readonly bulkScreeningJobRepository: BulkScreeningJobRepository;
}

/**
 * RF-BS-2/RNF-BS-1: 404 for both non-existent and cross-org job ids so
 * neither their existence nor their ownership is leaked.
 */
export function createGetBulkScreeningJobUseCase(deps: GetBulkScreeningJobDeps) {
  return async function getBulkScreeningJob(
    input: GetBulkScreeningJobInput,
  ): Promise<BulkScreeningJobView> {
    const organizationId = requireTenantContext(input.auth);

    let jobId;
    try {
      jobId = createBulkScreeningJobId(input.jobId);
    } catch {
      throw bulkScreeningJobNotFound(input.jobId);
    }

    const job = await deps.bulkScreeningJobRepository.findByIdForOrg(jobId, organizationId);
    if (job === null) {
      throw bulkScreeningJobNotFound(input.jobId);
    }

    return {
      id: String(job.id),
      status: job.status,
      totalRows: job.totalRows,
      processedRows: job.processedRows,
      errors: job.errors,
    };
  };
}
