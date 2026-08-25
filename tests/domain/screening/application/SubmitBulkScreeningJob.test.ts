import { oid } from '../../../support/oid.js';
import { createSubmitBulkScreeningJobUseCase } from '../../../../src/modules/screening/application/SubmitBulkScreeningJob.js';
import { generateBulkScreeningJobId } from '../../../../src/modules/screening/domain/model/value-objects/BulkScreeningJobId.js';
import type { AuditEvent, AuditRecorder } from '../../../../src/modules/screening/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../../../src/modules/screening/domain/ports/UnitOfWork.js';
import { InMemoryBulkScreeningJobRepository } from '../../../helpers/screening/InMemoryBulkScreeningJobRepository.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/screening/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG = oid('org-1');
const USER = oid('user-1');
const ANALYST = createAuthContext({ userId: USER, organizationId: ORG, actorType: 'USER' });
const PLATFORM_ADMIN = createAuthContext({ userId: USER, organizationId: null, actorType: 'PLATFORM_ADMIN' });

class RecordingAuditRecorder implements AuditRecorder {
  readonly events: AuditEvent[] = [];
  async record(event: AuditEvent, _tx?: Transaction): Promise<void> {
    this.events.push(event);
  }
}

function buildUseCase(scheduleWork?: (work: () => void) => void) {
  const jobRepository = new InMemoryBulkScreeningJobRepository();
  const auditRecorder = new RecordingAuditRecorder();
  const run = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
  const submitBulkScreeningJob = createSubmitBulkScreeningJobUseCase({
    bulkScreeningJobRepository: jobRepository,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateJobId: generateBulkScreeningJobId,
    scheduleWork: scheduleWork ?? ((work) => work()),
    createRunJob: () => run,
  });
  return { jobRepository, auditRecorder, submitBulkScreeningJob, run };
}

describe('createSubmitBulkScreeningJobUseCase', () => {
  it('creates a PENDING job scoped to caller org and writes SUBMIT_BULK_SCREENING_JOB audit', async () => {
    const { jobRepository, auditRecorder, submitBulkScreeningJob } = buildUseCase();

    const jobId = await submitBulkScreeningJob({
      auth: ANALYST,
      filePath: '/tmp/bulk/upload.csv',
    });

    const jobs = jobRepository.all();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe('PENDING');
    expect(jobs[0].organizationId).toBe(ORG);
    expect(jobs[0].filePath).toBe('/tmp/bulk/upload.csv');
    expect(jobs[0].createdBy).toBe(USER);
    expect(jobs[0].totalRows).toBe(0);

    expect(String(jobs[0].id)).toBe(String(jobId));

    expect(auditRecorder.events).toHaveLength(1);
    expect(auditRecorder.events[0]).toMatchObject({
      organizationId: ORG,
      action: 'SUBMIT_BULK_SCREENING_JOB',
      resource: 'bulk_screening_job',
      resourceId: String(jobId),
    });
  });

  it('calls scheduleWork exactly once after the transaction commits', async () => {
    const scheduled: Array<() => void> = [];
    const { submitBulkScreeningJob, run } = buildUseCase((work) => scheduled.push(work));

    await submitBulkScreeningJob({ auth: ANALYST, filePath: '/tmp/bulk/file.csv' });

    expect(scheduled).toHaveLength(1);
    expect(run).not.toHaveBeenCalled();

    // execute the scheduled work
    scheduled[0]();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('passes the submitter auth to the scheduled run function', async () => {
    const scheduled: Array<() => void> = [];
    const { submitBulkScreeningJob, run } = buildUseCase((work) => scheduled.push(work));

    await submitBulkScreeningJob({ auth: ANALYST, filePath: '/tmp/bulk/file.csv' });
    scheduled[0]();

    // The run mock is called once, meaning the closure correctly invoked it
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('throws FORBIDDEN_CROSS_TENANT when auth has no organizationId', async () => {
    const { submitBulkScreeningJob } = buildUseCase();

    await expect(
      submitBulkScreeningJob({ auth: PLATFORM_ADMIN, filePath: '/tmp/bulk/file.csv' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });

  it('routes a rejected run() to onRunError instead of leaving an unhandled rejection', async () => {
    const onRunError = jest.fn();
    const jobRepository = new InMemoryBulkScreeningJobRepository();
    const auditRecorder = new RecordingAuditRecorder();
    const run = jest.fn<Promise<void>, []>().mockRejectedValue(new Error('boom'));
    const submitBulkScreeningJob = createSubmitBulkScreeningJobUseCase({
      bulkScreeningJobRepository: jobRepository,
      auditRecorder,
      unitOfWork: new PassthroughUnitOfWork(),
      clock: new FixedClock(NOW),
      generateJobId: generateBulkScreeningJobId,
      scheduleWork: (work) => work(),
      createRunJob: () => run,
      onRunError,
    });

    await expect(
      submitBulkScreeningJob({ auth: ANALYST, filePath: '/tmp/bulk/file.csv' }),
    ).resolves.toBeDefined();

    await Promise.resolve();
    expect(onRunError).toHaveBeenCalledTimes(1);
    expect(onRunError.mock.calls[0][0]).toEqual(new Error('boom'));
  });
});
