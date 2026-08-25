import { oid } from '../../../support/oid.js';
import { createGetBulkScreeningJobUseCase } from '../../../../src/modules/screening/application/GetBulkScreeningJob.js';
import { BulkScreeningJob } from '../../../../src/modules/screening/domain/model/aggregates/BulkScreeningJob.js';
import { generateBulkScreeningJobId } from '../../../../src/modules/screening/domain/model/value-objects/BulkScreeningJobId.js';
import { InMemoryBulkScreeningJobRepository } from '../../../helpers/screening/InMemoryBulkScreeningJobRepository.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const ANALYST = createAuthContext({ userId: oid('user-1'), organizationId: ORG_1, actorType: 'USER' });
const OTHER_ANALYST = createAuthContext({ userId: oid('user-2'), organizationId: ORG_2, actorType: 'USER' });
const PLATFORM_ADMIN = createAuthContext({ userId: oid('user-3'), organizationId: null, actorType: 'PLATFORM_ADMIN' });

function buildJob(overrides: { organizationId?: string } = {}): BulkScreeningJob {
  return BulkScreeningJob.create({
    id: generateBulkScreeningJobId(),
    organizationId: overrides.organizationId ?? ORG_1,
    filePath: '/tmp/bulk/file.csv',
    totalRows: 100,
    createdBy: oid('user-1'),
    now: NOW,
  });
}

function buildUseCase() {
  const jobRepository = new InMemoryBulkScreeningJobRepository();
  const getJob = createGetBulkScreeningJobUseCase({ bulkScreeningJobRepository: jobRepository });
  return { jobRepository, getJob };
}

describe('createGetBulkScreeningJobUseCase', () => {
  it('returns view with id, status, totalRows, processedRows, and errors — no filePath', async () => {
    const { jobRepository, getJob } = buildUseCase();
    const job = buildJob();
    await jobRepository.create(job);

    const view = await getJob({ auth: ANALYST, jobId: String(job.id) });

    expect(view.id).toBe(String(job.id));
    expect(view.status).toBe('PENDING');
    expect(view.totalRows).toBe(100);
    expect(view.processedRows).toBe(0);
    expect(view.errors).toBe('');
    expect((view as unknown as Record<string, unknown>).filePath).toBeUndefined();
  });

  it('throws BULK_SCREENING_JOB_NOT_FOUND for an unknown jobId', async () => {
    const { getJob } = buildUseCase();

    await expect(
      getJob({ auth: ANALYST, jobId: generateBulkScreeningJobId() }),
    ).rejects.toMatchObject({ code: 'BULK_SCREENING_JOB_NOT_FOUND' });
  });

  it('throws BULK_SCREENING_JOB_NOT_FOUND for a cross-org jobId (no existence leak)', async () => {
    const { jobRepository, getJob } = buildUseCase();
    const job = buildJob({ organizationId: ORG_1 });
    await jobRepository.create(job);

    await expect(
      getJob({ auth: OTHER_ANALYST, jobId: String(job.id) }),
    ).rejects.toMatchObject({ code: 'BULK_SCREENING_JOB_NOT_FOUND' });
  });

  it('throws FORBIDDEN_CROSS_TENANT when auth has no organizationId', async () => {
    const { getJob } = buildUseCase();

    await expect(
      getJob({ auth: PLATFORM_ADMIN, jobId: generateBulkScreeningJobId() }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });

  it('throws BULK_SCREENING_JOB_NOT_FOUND for a malformed jobId (not a valid ObjectId)', async () => {
    const { getJob } = buildUseCase();

    await expect(
      getJob({ auth: ANALYST, jobId: 'not-a-valid-object-id' }),
    ).rejects.toMatchObject({ code: 'BULK_SCREENING_JOB_NOT_FOUND' });
  });
});
