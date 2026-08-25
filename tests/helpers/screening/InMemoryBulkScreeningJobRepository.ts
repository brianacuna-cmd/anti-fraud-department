import type { BulkScreeningJob } from '../../../src/modules/screening/domain/model/aggregates/BulkScreeningJob.js';
import type { BulkScreeningJobId } from '../../../src/modules/screening/domain/model/value-objects/BulkScreeningJobId.js';
import type { Instant } from '../../../src/shared/time/Instant.js';
import type { BulkScreeningJobRepository } from '../../../src/modules/screening/domain/ports/BulkScreeningJobRepository.js';

/** In-memory `BulkScreeningJobRepository` fake for domain/application-level tests. */
export class InMemoryBulkScreeningJobRepository implements BulkScreeningJobRepository {
  private readonly byId = new Map<string, BulkScreeningJob>();

  readonly incrementProgressCalls: Array<{ id: BulkScreeningJobId; amount: number; now: Instant }> = [];

  async create(job: BulkScreeningJob): Promise<void> {
    this.byId.set(String(job.id), job);
  }

  async findByIdForOrg(
    id: BulkScreeningJobId,
    organizationId: string,
  ): Promise<BulkScreeningJob | null> {
    const job = this.byId.get(String(id)) ?? null;
    if (job === null || job.organizationId !== organizationId) return null;
    return job;
  }

  async incrementProgress(id: BulkScreeningJobId, amount: number, now: Instant): Promise<void> {
    this.incrementProgressCalls.push({ id, amount, now });
    const job = this.byId.get(String(id));
    if (job) {
      this.byId.set(String(id), job);
    }
  }

  async saveStatus(job: BulkScreeningJob): Promise<void> {
    this.byId.set(String(job.id), job);
  }

  all(): BulkScreeningJob[] {
    return [...this.byId.values()];
  }
}
