import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoBulkScreeningJobRepository } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/MongoBulkScreeningJobRepository.js';
import { BulkScreeningJob } from '../../../src/modules/screening/domain/model/aggregates/BulkScreeningJob.js';
import { generateBulkScreeningJobId } from '../../../src/modules/screening/domain/model/value-objects/BulkScreeningJobId.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';

jest.setTimeout(60_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));

function buildJob(overrides: { organizationId?: string; totalRows?: number } = {}): BulkScreeningJob {
  return BulkScreeningJob.create({
    id: generateBulkScreeningJobId(),
    organizationId: overrides.organizationId ?? oid('org-1'),
    filePath: '/tmp/bulk/file.csv',
    totalRows: overrides.totalRows ?? 50,
    createdBy: oid('user-1'),
    now: NOW,
  });
}

describe('MongoBulkScreeningJobRepository (integration, real Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoBulkScreeningJobRepository;

  beforeAll(async () => {
    replicaSet = await startReplicaSetMongo();
    const connection = await connectMongo(replicaSet.getUri(), 'anti_fraud_test');
    client = connection.client;
    db = connection.db;
    await ensureIndexes(db);
  });

  afterAll(async () => {
    await client.close();
    await replicaSet.stop();
  });

  beforeEach(() => {
    repository = new MongoBulkScreeningJobRepository(db);
  });

  afterEach(async () => {
    await db.collection('bulk_screening_jobs').deleteMany({});
  });

  it('create / findByIdForOrg round-trip', async () => {
    const job = buildJob();
    await repository.create(job);

    const found = await repository.findByIdForOrg(job.id, oid('org-1'));
    expect(found?.id).toBe(job.id);
    expect(found?.status).toBe('PENDING');
    expect(found?.totalRows).toBe(50);
    expect(found?.processedRows).toBe(0);
    expect(found?.errors).toBe('');
  });

  it('findByIdForOrg returns null for unknown id', async () => {
    const found = await repository.findByIdForOrg(generateBulkScreeningJobId(), oid('org-1'));
    expect(found).toBeNull();
  });

  it('findByIdForOrg returns null for cross-org access', async () => {
    const job = buildJob({ organizationId: oid('org-1') });
    await repository.create(job);

    const found = await repository.findByIdForOrg(job.id, oid('org-2'));
    expect(found).toBeNull();
  });

  it('incrementProgress applies $inc on processed_rows and updates updated_at', async () => {
    const job = buildJob();
    await repository.create(job);

    await repository.incrementProgress(job.id, 50, LATER);

    const found = await repository.findByIdForOrg(job.id, oid('org-1'));
    expect(found?.processedRows).toBe(50);
    expect(found?.updatedAt).toBe(LATER);
  });

  it('saveStatus persists status, errors, and updated_at', async () => {
    const job = buildJob();
    await repository.create(job);

    const completed = job
      .startProcessing(NOW)
      .appendError('Row 1: invalid wallet format')
      .complete(LATER);
    await repository.saveStatus(completed);

    const found = await repository.findByIdForOrg(job.id, oid('org-1'));
    expect(found?.status).toBe('COMPLETED');
    expect(found?.errors).toBe('Row 1: invalid wallet format');
    expect(found?.updatedAt).toBe(LATER);
  });

  it('(org,status) and (org,created_at) indexes exist on bulk_screening_jobs', async () => {
    const indexes = await db.collection('bulk_screening_jobs').indexes();
    const names = indexes.map((idx) => idx.name);
    expect(names).toContain('bulk_screening_jobs_org_status_idx');
    expect(names).toContain('bulk_screening_jobs_org_created_idx');
  });
});
