import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoScreeningWatermarkRepository } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/MongoScreeningWatermarkRepository.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { oid } from '../../support/oid.js';

jest.setTimeout(60_000);

const ORG_ID = oid('org-1');
const JOB = 'wallet-rescreen';

const T1 = fromDate(new Date('2026-01-10T12:00:00.000Z'));
const T2 = fromDate(new Date('2026-01-15T00:00:00.000Z'));

describe('MongoScreeningWatermarkRepository (integration)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoScreeningWatermarkRepository;

  beforeAll(async () => {
    replicaSet = await startReplicaSetMongo();
    const connection = await connectMongo(replicaSet.getUri(), 'anti_fraud_test');
    client = connection.client;
    db = connection.db;
  });

  afterAll(async () => {
    await client.close();
    await replicaSet.stop();
  });

  beforeEach(() => {
    repository = new MongoScreeningWatermarkRepository(db);
  });

  afterEach(async () => {
    await db.collection('screening_watermarks').deleteMany({});
  });

  // Task 2.1 — RED: read returns null on first call (no document in collection)
  it('read returns null when no watermark exists for org + job', async () => {
    const result = await repository.read(ORG_ID, JOB);
    expect(result).toBeNull();
  });

  // Triangulate: different org scoped separately
  it('read returns null when watermark exists only for a different job', async () => {
    await repository.advance(ORG_ID, 'other-job', T1);
    const result = await repository.read(ORG_ID, JOB);
    expect(result).toBeNull();
  });

  // Task 2.2 — RED: advance upsert persists and read returns it
  it('advance persists the watermark and read returns the same instant', async () => {
    await repository.advance(ORG_ID, JOB, T1);
    const result = await repository.read(ORG_ID, JOB);
    expect(result).toBe(T1);
  });

  // Triangulate: last-write-wins — second advance overwrites the first
  it('advance is last-write-wins: a later advance overwrites an earlier one', async () => {
    await repository.advance(ORG_ID, JOB, T1);
    await repository.advance(ORG_ID, JOB, T2);
    const result = await repository.read(ORG_ID, JOB);
    expect(result).toBe(T2);
  });

  // Task 2.2 — RED: watermark survives "restart" (new repo instance, same db)
  it('watermark survives a repository restart (new instance, same db)', async () => {
    await repository.advance(ORG_ID, JOB, T1);

    const freshRepository = new MongoScreeningWatermarkRepository(db);
    const result = await freshRepository.read(ORG_ID, JOB);
    expect(result).toBe(T1);
  });

  // Triangulate: org isolation — different org does not bleed across
  it('read is scoped by organizationId — different org returns null', async () => {
    await repository.advance(ORG_ID, JOB, T1);
    const result = await repository.read(oid('org-2'), JOB);
    expect(result).toBeNull();
  });
});
