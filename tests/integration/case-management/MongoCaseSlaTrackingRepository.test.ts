import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoCaseSlaTrackingRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoCaseSlaTrackingRepository.js';
import { CaseSlaTracking } from '../../../src/modules/case-management/domain/model/aggregates/CaseSlaTracking.js';
import { createCaseSlaTrackingId } from '../../../src/modules/case-management/domain/model/value-objects/CaseSlaTrackingId.js';
import { createCaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { extractDuplicateKeyIndexName } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/duplicateKey.js';
import type { CaseSlaTrackingDocument } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/documents/CaseSlaTrackingDocument.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const DUE = fromDate(new Date('2026-01-01T01:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-01T02:00:00.000Z'));

function buildTracking(
  id: string,
  caseId = 'case-1',
  overrides: Partial<Parameters<typeof CaseSlaTracking.create>[0]> = {},
): CaseSlaTracking {
  return CaseSlaTracking.create({
    id: createCaseSlaTrackingId(id),
    caseId: createCaseId(caseId),
    dueDate: DUE,
    now: NOW,
    ...overrides,
  });
}

describe('MongoCaseSlaTrackingRepository (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoCaseSlaTrackingRepository;

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
    repository = new MongoCaseSlaTrackingRepository(db);
  });

  afterEach(async () => {
    await db.collection('CaseSlaTracking').deleteMany({});
  });

  it('saves a tracking row and retrieves it by CaseId', async () => {
    await repository.save(buildTracking('tracking-1'));

    const found = await repository.findByCaseId(createCaseId('case-1'));

    expect(found?.caseId).toBe('case-1');
    expect(found?.status).toBe('ON_TRACK');
    expect(found?.notificationSent).toBe(false);
  });

  it('returns null when no tracking row matches the given CaseId', async () => {
    const found = await repository.findByCaseId(createCaseId('missing-case'));

    expect(found).toBeNull();
  });

  it('save is idempotent by _id: re-saving the same tracking row updates it, not a duplicate', async () => {
    const tracking = buildTracking('tracking-1');
    await repository.save(tracking);
    await repository.save(tracking.advanceTo('WARNING', LATER));

    const documents = await db
      .collection<CaseSlaTrackingDocument>('CaseSlaTracking')
      .find({ CaseId: 'case-1' })
      .toArray();

    expect(documents).toHaveLength(1);
    expect(documents[0]?.Status).toBe('WARNING');
  });

  /**
   * Regression guard for the `sla_tracking_case_unique` index: a raw insert
   * bypassing the repository's save path (e.g. a second document minted
   * with a DIFFERENT `_id` for the same CaseId) MUST be rejected by Mongo
   * itself — the index name, not app code, is the invariant guard (design:
   * "unique sla_tracking_case_unique (one per CaseId)").
   */
  it('rejects a raw duplicate CaseId insert via the sla_tracking_case_unique index', async () => {
    await repository.save(buildTracking('tracking-1'));

    let caughtError: unknown;
    try {
      await db.collection('CaseSlaTracking').insertOne({
        _id: 'tracking-2',
        CaseId: 'case-1',
        DueDate: DUE,
        DueDateAt: new Date(DUE),
        Status: 'ON_TRACK',
        NotificationSent: false,
        CreatedAt: NOW,
        UpdatedAt: NOW,
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeDefined();
    expect(extractDuplicateKeyIndexName(caughtError)).toBe('sla_tracking_case_unique');
  });

  /**
   * Query-shape correctness for `findDueForSweep` (Slice 4 task 4) — not
   * functionally exercised by a real scheduler yet (that lands in Slice 13),
   * but the range query against `DueDateAt` (BSON Date mirror) + the
   * `Status != BREACHED` filter must already behave correctly.
   */
  describe('findDueForSweep (query shape only — sweep logic lands in Slice 13)', () => {
    it('returns rows whose DueDateAt has passed and are not yet BREACHED', async () => {
      await repository.save(buildTracking('tracking-due', 'case-due', { dueDate: NOW }));
      await repository.save(buildTracking('tracking-future', 'case-future', { dueDate: LATER }));
      const breached = buildTracking('tracking-breached', 'case-breached', { dueDate: NOW }).advanceTo(
        'WARNING',
        NOW,
      ).advanceTo('BREACHED', NOW);
      await repository.save(breached);

      const due = await repository.findDueForSweep(NOW);

      expect(due.map((row) => row.caseId).sort()).toEqual(['case-due']);
    });
  });

  it('round-trips the raw document by _id as a plain string, with DueDateAt mirroring DueDate', async () => {
    await repository.save(buildTracking('tracking-id-guard'));

    const rawDocument = await db
      .collection<CaseSlaTrackingDocument>('CaseSlaTracking')
      .findOne({ CaseId: 'case-1' });

    expect(rawDocument).not.toBeNull();
    expect(rawDocument?._id).toBe('tracking-id-guard');
    expect(typeof rawDocument?._id).toBe('string');
    expect(rawDocument?.DueDateAt.toISOString()).toBe(DUE);
  });
});
