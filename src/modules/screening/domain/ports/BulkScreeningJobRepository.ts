import type { BulkScreeningJob } from '../model/aggregates/BulkScreeningJob.js';
import type { BulkScreeningJobId } from '../model/value-objects/BulkScreeningJobId.js';
import type { Instant } from '../../../../shared/time/Instant.js';
import type { Transaction } from './UnitOfWork.js';

/** Outbound port for `BulkScreeningJob` persistence. */
export interface BulkScreeningJobRepository {
  create(job: BulkScreeningJob, tx?: Transaction): Promise<void>;
  findByIdForOrg(
    id: BulkScreeningJobId,
    organizationId: string,
    tx?: Transaction,
  ): Promise<BulkScreeningJob | null>;
  /**
   * Atomically increments `processed_rows` by `amount` using `$inc`.
   * Also updates `updated_at` to `now`. Used by the worker every 50 rows.
   */
  incrementProgress(
    id: BulkScreeningJobId,
    amount: number,
    now: Instant,
    tx?: Transaction,
  ): Promise<void>;
  /** Persists `status`, `errors`, `omitted`, and `updated_at` via `$set`. */
  saveStatus(job: BulkScreeningJob, tx?: Transaction): Promise<void>;
}
