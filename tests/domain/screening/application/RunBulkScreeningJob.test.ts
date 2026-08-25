import { oid } from '../../../support/oid.js';
import { createRunBulkScreeningJobUseCase } from '../../../../src/modules/screening/application/RunBulkScreeningJob.js';
import { BulkScreeningJob } from '../../../../src/modules/screening/domain/model/aggregates/BulkScreeningJob.js';
import { generateBulkScreeningJobId } from '../../../../src/modules/screening/domain/model/value-objects/BulkScreeningJobId.js';
import type { BulkCsvSource, CsvRow } from '../../../../src/modules/screening/domain/ports/BulkCsvSource.js';
import type { AuditEvent, AuditRecorder } from '../../../../src/modules/screening/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../../../src/modules/screening/domain/ports/UnitOfWork.js';
import type { ScreenSubjectAgainstWatchlistInput } from '../../../../src/modules/screening/application/ScreenSubjectAgainstWatchlist.js';
import { InMemoryBulkScreeningJobRepository } from '../../../helpers/screening/InMemoryBulkScreeningJobRepository.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { ScreeningError } from '../../../../src/modules/screening/domain/errors/ScreeningError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG = oid('org-1');
const USER = oid('user-1');
const FILE = '/tmp/bulk/upload.csv';

const ANALYST = createAuthContext({ userId: USER, organizationId: ORG, actorType: 'USER' });

class RecordingAuditRecorder implements AuditRecorder {
  readonly events: AuditEvent[] = [];
  async record(event: AuditEvent, _tx?: Transaction): Promise<void> {
    this.events.push(event);
  }
}

class FakeBulkCsvSource implements BulkCsvSource {
  readonly discardCalls: string[] = [];

  constructor(private readonly data: CsvRow[] | Error) {}

  async *readRows(_filePath: string): AsyncGenerator<CsvRow> {
    if (this.data instanceof Error) throw this.data;
    for (const row of this.data) yield row;
  }

  async discard(filePath: string): Promise<void> {
    this.discardCalls.push(filePath);
  }
}

function buildJob(orgId = ORG): BulkScreeningJob {
  return BulkScreeningJob.create({
    id: generateBulkScreeningJobId(),
    organizationId: orgId,
    filePath: FILE,
    totalRows: 0,
    createdBy: USER,
    now: NOW,
  });
}

function buildUseCase(
  csvRows: CsvRow[] | Error,
  screenSubjectCalls: ScreenSubjectAgainstWatchlistInput[] = [],
) {
  const jobRepository = new InMemoryBulkScreeningJobRepository();
  const auditRecorder = new RecordingAuditRecorder();
  const source = new FakeBulkCsvSource(csvRows);
  const screenSubject = jest.fn(async (input: ScreenSubjectAgainstWatchlistInput) => {
    screenSubjectCalls.push(input);
    return { matches: [], riskSignal: null };
  });
  const runJob = createRunBulkScreeningJobUseCase({
    bulkScreeningJobRepository: jobRepository,
    bulkCsvSource: source,
    screenSubject,
    auditRecorder,
    clock: new FixedClock(NOW),
    yieldWork: () => Promise.resolve(),
  });
  return { jobRepository, auditRecorder, source, screenSubject, runJob };
}

describe('createRunBulkScreeningJobUseCase', () => {
  it('transitions PENDING→PROCESSING→COMPLETED for mixed valid/invalid rows', async () => {
    const calls: ScreenSubjectAgainstWatchlistInput[] = [];
    const { jobRepository, auditRecorder, source, runJob } = buildUseCase(
      [
        { customer_id: 'cust-1', entry_type: 'PERSON', name: 'Alice' },
        { customer_id: '', entry_type: 'PERSON', name: 'Bob' },              // empty customer_id → row error
        { customer_id: 'cust-3', entry_type: 'INVALID', name: 'Carol' },     // invalid entry_type → row error
        { customer_id: 'cust-4', entry_type: 'PERSON', name: 'Dave' },       // valid
      ],
      calls,
    );
    const job = buildJob();
    await jobRepository.create(job);

    await runJob({ auth: ANALYST, jobId: job.id });

    const saved = await jobRepository.findByIdForOrg(job.id, ORG);
    expect(saved?.status).toBe('COMPLETED');
    expect(saved?.totalRows).toBe(4);
    expect(calls).toHaveLength(2); // only cust-1 and cust-4 are valid

    expect(saved?.errors).toContain('Row 2');
    expect(saved?.errors).toContain('Row 3: invalid entry_type');

    const completeAudit = auditRecorder.events.find((e) => e.action === 'COMPLETE_BULK_SCREENING_JOB');
    expect(completeAudit).toBeDefined();
    expect(completeAudit?.resource).toBe('bulk_screening_job');

    expect(source.discardCalls).toContain(FILE);
  });

  it('transitions to FAILED and writes FAIL audit when header missing customer_id', async () => {
    const csvError = new ScreeningError('CSV_HEADER_INVALID', 'no customer_id column', {});
    const { jobRepository, auditRecorder, source, screenSubject, runJob } = buildUseCase(csvError);
    const job = buildJob();
    await jobRepository.create(job);

    await runJob({ auth: ANALYST, jobId: job.id });

    const saved = await jobRepository.findByIdForOrg(job.id, ORG);
    expect(saved?.status).toBe('FAILED');
    expect(screenSubject).not.toHaveBeenCalled();

    const failAudit = auditRecorder.events.find((e) => e.action === 'FAIL_BULK_SCREENING_JOB');
    expect(failAudit).toBeDefined();
    expect(failAudit?.resource).toBe('bulk_screening_job');

    expect(source.discardCalls).toContain(FILE);
  });

  it('appends row error for invalid entry_type and continues processing other rows', async () => {
    const calls: ScreenSubjectAgainstWatchlistInput[] = [];
    const { jobRepository, runJob } = buildUseCase(
      [
        { customer_id: 'cust-1', entry_type: 'BAD_TYPE', name: 'Alice' },
        { customer_id: 'cust-2', entry_type: 'ORGANIZATION', name: 'Acme Corp' },
      ],
      calls,
    );
    const job = buildJob();
    await jobRepository.create(job);

    await runJob({ auth: ANALYST, jobId: job.id });

    const saved = await jobRepository.findByIdForOrg(job.id, ORG);
    expect(saved?.status).toBe('COMPLETED');
    expect(saved?.errors).toContain('Row 1: invalid entry_type');
    expect(calls).toHaveLength(1);
    expect(calls[0].customerId).toBe('cust-2');
  });

  it('appends row error for missing required identifiers (no name/document/wallet_address)', async () => {
    const { jobRepository, runJob } = buildUseCase([
      { customer_id: 'cust-1', entry_type: 'PERSON' }, // no identifiers
    ]);
    const job = buildJob();
    await jobRepository.create(job);

    await runJob({ auth: ANALYST, jobId: job.id });

    const saved = await jobRepository.findByIdForOrg(job.id, ORG);
    expect(saved?.status).toBe('COMPLETED');
    expect(saved?.errors).toContain('Row 1');
    expect(saved?.totalRows).toBe(1);
  });

  it('calls $inc processed_rows every 50 rows and yields between batches', async () => {
    const rows: CsvRow[] = Array.from({ length: 105 }, (_, i) => ({
      customer_id: `cust-${i + 1}`,
      entry_type: 'PERSON',
      name: `Name ${i + 1}`,
    }));
    const { jobRepository, runJob } = buildUseCase(rows);
    const job = buildJob();
    await jobRepository.create(job);

    await runJob({ auth: ANALYST, jobId: job.id });

    // 2 full batches of 50 + remainder of 5 = 3 $inc calls total
    expect(jobRepository.incrementProgressCalls.length).toBe(3);
    expect(jobRepository.incrementProgressCalls[0].amount).toBe(50);
    expect(jobRepository.incrementProgressCalls[1].amount).toBe(50);
    expect(jobRepository.incrementProgressCalls[2].amount).toBe(5);

    const saved = await jobRepository.findByIdForOrg(job.id, ORG);
    expect(saved?.totalRows).toBe(105);
  });

  it('returns early without throwing when the job does not exist', async () => {
    const { runJob } = buildUseCase([]);
    // No job created — should not throw
    await expect(
      runJob({ auth: ANALYST, jobId: generateBulkScreeningJobId() }),
    ).resolves.toBeUndefined();
  });

  it('COMPLETED even when all rows are invalid (errors non-empty)', async () => {
    const { jobRepository, runJob } = buildUseCase([
      { customer_id: '', entry_type: 'PERSON', name: 'Alice' },
      { customer_id: 'cust-2', entry_type: 'BAD' },
    ]);
    const job = buildJob();
    await jobRepository.create(job);

    await runJob({ auth: ANALYST, jobId: job.id });

    const saved = await jobRepository.findByIdForOrg(job.id, ORG);
    expect(saved?.status).toBe('COMPLETED');
    expect(saved?.totalRows).toBe(2);
  });

  it('screens valid row with reconstructed auth context (org + user from submitter)', async () => {
    const calls: ScreenSubjectAgainstWatchlistInput[] = [];
    const { jobRepository, runJob } = buildUseCase(
      [{ customer_id: 'cust-1', entry_type: 'PERSON', name: 'Alice' }],
      calls,
    );
    const job = buildJob();
    await jobRepository.create(job);

    await runJob({ auth: ANALYST, jobId: job.id });

    expect(calls).toHaveLength(1);
    expect(calls[0].auth.organizationId).toBe(ORG);
    expect(calls[0].customerId).toBe('cust-1');
  });
});
