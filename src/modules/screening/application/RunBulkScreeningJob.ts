import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { BulkScreeningJobId } from '../domain/model/value-objects/BulkScreeningJobId.js';
import type { BulkScreeningJobRepository } from '../domain/ports/BulkScreeningJobRepository.js';
import type { BulkCsvSource, CsvRow } from '../domain/ports/BulkCsvSource.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type {
  ScreenSubjectAgainstWatchlistInput,
  ScreenSubjectAgainstWatchlistResult,
} from './ScreenSubjectAgainstWatchlist.js';
import { isEntryType } from '../domain/model/value-objects/EntryType.js';

const PROGRESS_BATCH_SIZE = 50;

export interface RunBulkScreeningJobInput {
  readonly auth: AuthContext;
  readonly jobId: BulkScreeningJobId;
}

export interface RunBulkScreeningJobDeps {
  readonly bulkScreeningJobRepository: BulkScreeningJobRepository;
  readonly bulkCsvSource: BulkCsvSource;
  readonly screenSubject: (
    input: ScreenSubjectAgainstWatchlistInput,
  ) => Promise<ScreenSubjectAgainstWatchlistResult>;
  readonly auditRecorder: AuditRecorder;
  readonly clock: Clock;
  /**
   * Injectable yield so the event loop is freed between every 50-row batch.
   * Default: `() => new Promise(r => setImmediate(r))`.
   * Tests supply `() => Promise.resolve()` to stay synchronous.
   */
  readonly yieldWork?: () => Promise<void>;
}

function validateRow(row: CsvRow, rowNum: number): string | null {
  if (!row.customer_id) {
    return `Row ${rowNum}: missing customer_id`;
  }
  if (!isEntryType(row.entry_type)) {
    return `Row ${rowNum}: invalid entry_type`;
  }
  const hasIdentifier = Boolean(
    row.name?.trim() || row.document?.trim() || row.wallet_address?.trim(),
  );
  if (!hasIdentifier) {
    return `Row ${rowNum}: missing required identifier`;
  }
  return null;
}

/**
 * RF-BS-3 / RF-BS-4: streams the CSV, calls `ScreenSubjectAgainstWatchlist`
 * per valid row, persists progress every 50 rows, and transitions the job to
 * COMPLETED or FAILED. Runs in the background after `SubmitBulkScreeningJob`
 * schedules it; never exposed via HTTP. Fail-closed: missing job → log and
 * return without throwing.
 */
export function createRunBulkScreeningJobUseCase(deps: RunBulkScreeningJobDeps) {
  const yieldWork = deps.yieldWork ?? (() => new Promise<void>((r) => setImmediate(r)));

  return async function runBulkScreeningJob(input: RunBulkScreeningJobInput): Promise<void> {
    const { auth, jobId } = input;

    const orgId = auth.organizationId;
    if (orgId === null) {
      console.error('RunBulkScreeningJob: auth has no organizationId', { jobId: String(jobId) });
      return;
    }

    const job = await deps.bulkScreeningJobRepository.findByIdForOrg(jobId, orgId);
    if (job === null) {
      console.error('RunBulkScreeningJob: job not found or inaccessible', { jobId: String(jobId) });
      return;
    }

    const startedAt = deps.clock.now();
    const processingJob = job.startProcessing(startedAt);
    await deps.bulkScreeningJobRepository.saveStatus(processingJob);

    const filePath = job.filePath;
    let workingJob = processingJob;
    let totalCount = 0;
    let batchSize = 0;

    try {
      for await (const row of deps.bulkCsvSource.readRows(filePath)) {
        totalCount++;
        batchSize++;

        const rowError = validateRow(row, totalCount);
        if (rowError !== null) {
          workingJob = workingJob.appendError(rowError);
        } else {
          await deps.screenSubject({
            auth,
            customerId: row.customer_id,
            // validated by validateRow — safe cast
            entryType: row.entry_type as 'PERSON' | 'ORGANIZATION' | 'WALLET',
            name: row.name || undefined,
            document: row.document || undefined,
            walletAddress: row.wallet_address || undefined,
          });
        }

        if (batchSize === PROGRESS_BATCH_SIZE) {
          await deps.bulkScreeningJobRepository.incrementProgress(
            workingJob.id,
            PROGRESS_BATCH_SIZE,
            deps.clock.now(),
          );
          await yieldWork();
          batchSize = 0;
        }
      }

      if (batchSize > 0) {
        await deps.bulkScreeningJobRepository.incrementProgress(
          workingJob.id,
          batchSize,
          deps.clock.now(),
        );
      }

      const completed = workingJob.setTotalRows(totalCount).complete(deps.clock.now());
      await deps.bulkScreeningJobRepository.saveStatus(completed);

      await deps.auditRecorder.record({
        organizationId: orgId,
        actorType: auth.actorType,
        actorId: auth.userId,
        action: 'COMPLETE_BULK_SCREENING_JOB',
        resource: 'bulk_screening_job',
        resourceId: String(jobId),
        detail: { totalRows: totalCount },
        ipAddress: auth.ipAddress,
      });
    } catch {
      const failed = workingJob.setTotalRows(totalCount).fail(deps.clock.now());
      await deps.bulkScreeningJobRepository.saveStatus(failed);

      await deps.auditRecorder.record({
        organizationId: orgId,
        actorType: auth.actorType,
        actorId: auth.userId,
        action: 'FAIL_BULK_SCREENING_JOB',
        resource: 'bulk_screening_job',
        resourceId: String(jobId),
        detail: { totalRows: totalCount },
        ipAddress: auth.ipAddress,
      });
    } finally {
      // Terminal status is already persisted; discard must not flip COMPLETED → FAILED.
      await deps.bulkCsvSource.discard(filePath).catch(() => undefined);
    }
  };
}
