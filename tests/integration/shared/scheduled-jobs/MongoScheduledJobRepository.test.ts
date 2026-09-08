import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId, type Db, type MongoClient } from 'mongodb';
import { connectMongo } from '../../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../../src/shared/persistence/mongo/ensureIndexes.js';
import { MongoScheduledJobRepository } from '../../../../src/shared/scheduled-jobs/mongo/MongoScheduledJobRepository.js';
import { fromDate, toDate } from '../../../../src/shared/time/Instant.js';
import { startReplicaSetMongo } from '../../../helpers/mongoTestServer.js';
import type { ScheduledJobDocument } from '../../../../src/shared/scheduled-jobs/mongo/ScheduledJobDocument.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-08-28T15:00:00.000Z'));
const LATER = fromDate(new Date('2026-08-28T15:05:00.000Z'));
const NEXT = fromDate(new Date('2026-08-28T15:06:00.000Z'));

describe('MongoScheduledJobRepository (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoScheduledJobRepository;

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
    repository = new MongoScheduledJobRepository(db);
  });

  afterEach(async () => {
    await db.collection('scheduled_jobs').deleteMany({});
  });

  it('upserts by name so a second recordRun keeps count at 1', async () => {
    await repository.recordRun({
      name: 'outbox_publish',
      lastRunAt: NOW,
      lastResult: 'SUCCESS',
      lastError: null,
      nextRunAt: NEXT,
    });
    await repository.recordRun({
      name: 'outbox_publish',
      lastRunAt: LATER,
      lastResult: 'FAILED',
      lastError: 'broker down',
      nextRunAt: NEXT,
    });

    const documents = await db
      .collection<ScheduledJobDocument>('scheduled_jobs')
      .find({ name: 'outbox_publish' })
      .toArray();

    expect(documents).toHaveLength(1);
    expect(documents[0]?.last_result).toBe('FAILED');
    expect(documents[0]?.last_error).toBe('broker down');
    expect(documents[0]?.last_run_at).toEqual(toDate(LATER));
    expect(documents[0]?.next_run_at).toEqual(toDate(NEXT));
  });

  it('preserves created_at via $setOnInsert across seed then recordRun', async () => {
    await repository.seed({
      name: 'sla_sweep',
      description: 'Sweep SLA tracking rows',
      cronExpression: 'every 60s',
      enabled: true,
      organizationId: null,
      now: NOW,
    });

    const afterSeed = await db.collection<ScheduledJobDocument>('scheduled_jobs').findOne({ name: 'sla_sweep' });
    expect(afterSeed?.created_at).toEqual(toDate(NOW));
    expect(afterSeed?.organization_id).toBeNull();
    expect(afterSeed?.description).toBe('Sweep SLA tracking rows');
    expect(afterSeed?.cron_expression).toBe('every 60s');
    expect(afterSeed?.enabled).toBe(true);

    await repository.recordRun({
      name: 'sla_sweep',
      lastRunAt: LATER,
      lastResult: 'SUCCESS',
      lastError: null,
      nextRunAt: NEXT,
    });

    const afterRun = await db.collection<ScheduledJobDocument>('scheduled_jobs').findOne({ name: 'sla_sweep' });
    expect(afterRun?.created_at).toEqual(toDate(NOW));
    expect(afterRun?._id).toEqual(afterSeed?._id);
    expect(afterRun?.last_result).toBe('SUCCESS');
    expect(await db.collection('scheduled_jobs').countDocuments({ name: 'sla_sweep' })).toBe(1);
  });

  it('does not churn created_at when seed is re-run with a later now', async () => {
    await repository.seed({
      name: 'directory_sync',
      description: 'Sync directory',
      cronExpression: 'every 15m',
      enabled: false,
      organizationId: null,
      now: NOW,
    });
    await repository.seed({
      name: 'directory_sync',
      description: 'Sync directory (updated label)',
      cronExpression: 'every 30m',
      enabled: true,
      organizationId: null,
      now: LATER,
    });

    const document = await db
      .collection<ScheduledJobDocument>('scheduled_jobs')
      .findOne({ name: 'directory_sync' });

    expect(document?.created_at).toEqual(toDate(NOW));
    expect(document?.description).toBe('Sync directory (updated label)');
    expect(document?.cron_expression).toBe('every 30m');
    expect(document?.enabled).toBe(true);
    expect(await db.collection('scheduled_jobs').countDocuments({ name: 'directory_sync' })).toBe(1);
  });

  it('findByName returns the domain row for a recorded name', async () => {
    await repository.seed({
      name: 'outbox_publish',
      description: 'Publish outbox events',
      cronExpression: 'every 5s',
      enabled: true,
      organizationId: null,
      now: NOW,
    });
    await repository.recordRun({
      name: 'outbox_publish',
      lastRunAt: LATER,
      lastResult: 'SUCCESS',
      lastError: null,
      nextRunAt: NEXT,
    });

    const found = await repository.findByName('outbox_publish');

    expect(found).not.toBeNull();
    expect(found!.name).toBe('outbox_publish');
    expect(found!.description).toBe('Publish outbox events');
    expect(found!.enabled).toBe(true);
    expect(found!.organizationId).toBeNull();
    expect(found!.lastResult).toBe('SUCCESS');
    expect(found!.lastError).toBeNull();
    expect(found!.lastRunAt).toBe(LATER);
    expect(found!.nextRunAt).toBe(NEXT);
    expect(found!.createdAt).toBe(NOW);
  });

  it('findByName returns null when no catalog row matches', async () => {
    await repository.seed({
      name: 'sla_sweep',
      description: 'Sweep SLA tracking rows',
      cronExpression: 'every 60s',
      enabled: true,
      organizationId: null,
      now: NOW,
    });

    await expect(repository.findByName('unknown_job')).resolves.toBeNull();
  });

  it('findByName coerces omitted seed-only tick fields to null', async () => {
    await repository.seed({
      name: 'directory_sync',
      description: 'Sync directory',
      cronExpression: 'every 15m',
      enabled: false,
      organizationId: null,
      now: NOW,
    });

    const raw = await db.collection<ScheduledJobDocument>('scheduled_jobs').findOne({ name: 'directory_sync' });
    expect(raw).not.toBeNull();
    expect(raw!).not.toHaveProperty('last_run_at');
    expect(raw!).not.toHaveProperty('next_run_at');
    expect(raw!).not.toHaveProperty('last_result');
    expect(raw!).not.toHaveProperty('last_error');

    const found = await repository.findByName('directory_sync');

    expect(found).not.toBeNull();
    expect(found!.name).toBe('directory_sync');
    expect(found!.enabled).toBe(false);
    expect(found!.lastRunAt).toBeNull();
    expect(found!.nextRunAt).toBeNull();
    expect(found!.lastResult).toBeNull();
    expect(found!.lastError).toBeNull();
  });

  it('keeps distinct names as separate documents', async () => {
    await repository.recordRun({
      name: 'sla_sweep',
      lastRunAt: NOW,
      lastResult: 'SUCCESS',
      lastError: null,
      nextRunAt: NEXT,
    });
    await repository.recordRun({
      name: 'outbox_publish',
      lastRunAt: NOW,
      lastResult: 'SUCCESS',
      lastError: null,
      nextRunAt: NEXT,
    });

    expect(await db.collection('scheduled_jobs').countDocuments({})).toBe(2);
  });
});
