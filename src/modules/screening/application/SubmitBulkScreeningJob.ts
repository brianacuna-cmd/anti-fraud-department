import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { BulkScreeningJobId } from '../domain/model/value-objects/BulkScreeningJobId.js';
import type { BulkScreeningJobRepository } from '../domain/ports/BulkScreeningJobRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { BulkScreeningJob } from '../domain/model/aggregates/BulkScreeningJob.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface SubmitBulkScreeningJobInput {
  readonly auth: AuthContext;
  readonly filePath: string;
}

export interface SubmitBulkScreeningJobDeps {
  readonly bulkScreeningJobRepository: BulkScreeningJobRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateJobId: () => BulkScreeningJobId;
  /**
   * Factory that returns the `run` function closed over the provided auth and
   * job id. Called once per submission so the worker inherits the submitter's
   * tenant/actor context for screening calls and terminal-state audits.
   */
  readonly createRunJob: (auth: AuthContext, jobId: BulkScreeningJobId) => () => Promise<void>;
  /** Default: `(work) => setImmediate(work)`. Mirrors `ReceiveProviderWebhook.schedulePostAck`. */
  readonly scheduleWork?: (work: () => void) => void;
}

/**
 * RF-BS-1: creates a PENDING `BulkScreeningJob` and writes a
 * `SUBMIT_BULK_SCREENING_JOB` audit row in one transaction, then schedules
 * the worker via the injectable `scheduleWork`.
 */
export function createSubmitBulkScreeningJobUseCase(deps: SubmitBulkScreeningJobDeps) {
  const schedule = deps.scheduleWork ?? ((work: () => void) => setImmediate(work));

  return async function submitBulkScreeningJob(
    input: SubmitBulkScreeningJobInput,
  ): Promise<BulkScreeningJobId> {
    const organizationId = requireTenantContext(input.auth);

    const jobId = deps.generateJobId();
    const now = deps.clock.now();

    const job = BulkScreeningJob.create({
      id: jobId,
      organizationId,
      filePath: input.filePath,
      totalRows: 0,
      createdBy: input.auth.userId,
      now,
    });

    await deps.unitOfWork.withTransaction(async (tx) => {
      await deps.bulkScreeningJobRepository.create(job, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'SUBMIT_BULK_SCREENING_JOB',
          resource: 'bulk_screening_job',
          resourceId: String(jobId),
          detail: { filePath: input.filePath },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );
    });

    const run = deps.createRunJob(input.auth, jobId);
    schedule(() => void run());

    return jobId;
  };
}
