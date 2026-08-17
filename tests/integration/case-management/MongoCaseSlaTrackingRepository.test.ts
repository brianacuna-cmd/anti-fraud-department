import { ObjectId } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoCaseSlaTrackingRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoCaseSlaTrackingRepository.js';
import { CaseSlaTracking } from '../../../src/modules/case-management/domain/model/aggregates/CaseSlaTracking.js';
import { createCaseSlaTrackingId } from '../../../src/modules/case-management/domain/model/value-objects/CaseSlaTrackingId.js';
import { createCaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { fromDate, toDate } from '../../../src/shared/time/Instant.js';
import { extractDuplicateKeyIndexName } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/duplicateKey.js';
import type { CaseSlaTrackingDocument } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/documents/CaseSlaTrackingDocument.js';
import { oid } from '../../support/oid.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const DUE = fromDate(new Date('2026-01-01T01:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-01T02:00:00.000Z'));

function buildTracking(
  id: string,
  caseId = oid('case-1'),
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
    await db.collection('case_sla_tracking').deleteMany({});
  });

  it('saves a tracking row and retrieves it by CaseId', async () => {
    await repository.save(buildTracking(oid('tracking-1')));

    const found = await repository.findByCaseId(createCaseId(oid('case-1')));

    expect(found?.caseId).toBe(oid('case-1'));
    expect(found?.status).toBe('ON_TRACK');
    expect(found?.notificationSent).toBe(false);
  });

  it('returns null when no tracking row matches the given CaseId', async () => {
    const found = await repository.findByCaseId(createCaseId(oid('missing-case')));

    expect(found).toBeNull();
  });

  it('save is idempotent by _id: re-saving the same tracking row updates it, not a duplicate', async () => {
    const tracking = buildTracking(oid('tracking-1'));
    await repository.save(tracking);
    await repository.save(tracking.advanceTo('WARNING', LATER));

    const documents = await db
      .collection<CaseSlaTrackingDocument>('case_sla_tracking')
      .find({ case_id: new ObjectId(oid('case-1')) })
      .toArray();

    expect(documents).toHaveLength(1);
    expect(documents[0]?.status).toBe('WARNING');
  });

  /**
   * Regression guard for the `sla_tracking_case_unique` index: a raw insert
   * bypassing the repository's save path (e.g. a second document minted
   * with a DIFFERENT `_id` for the same CaseId) MUST be rejected by Mongo
   * itself — the index name, not app code, is the invariant guard (design:
   * "unique sla_tracking_case_unique (one per CaseId)").
   */
  it('rejects a raw duplicate CaseId insert via the sla_tracking_case_unique index', async () => {
    await repository.save(buildTracking(oid('tracking-1')));

    let caughtError: unknown;
    try {
      await db.collection<CaseSlaTrackingDocument>('case_sla_tracking').insertOne({
        _id: new ObjectId(oid('tracking-2')),
        case_id: new ObjectId(oid('case-1')),
        due_date: toDate(DUE),
        status: 'ON_TRACK',
        notification_sent: false,
        created_at: toDate(NOW),
        updated_at: toDate(NOW),
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeDefined();
    expect(extractDuplicateKeyIndexName(caughtError)).toBe('sla_tracking_case_unique');
  });

  /**
   * Contract coverage for `findDueForSweep` (Slice 13: `SweepSlaTracking`
   * is the consumer of this query). The range query against `DueDateAt`
   * (BSON Date mirror) + the `Status != BREACHED` filter must exclude both
   * not-yet-due rows and already-BREACHED rows.
   */
  describe('findDueForSweep (contract: due-scoping, backs the SLA sweep)', () => {
    it('excludes a not-yet-due row and an already-BREACHED row, includes only due rows', async () => {
      await repository.save(buildTracking(oid('tracking-due'), oid('case-due'), { dueDate: NOW }));
      await repository.save(buildTracking(oid('tracking-future'), oid('case-future'), { dueDate: LATER }));
      const breached = buildTracking(oid('tracking-breached'), oid('case-breached'), { dueDate: NOW }).advanceTo(
        'WARNING',
        NOW,
      ).advanceTo('BREACHED', NOW);
      await repository.save(breached);

      const due = await repository.findDueForSweep(NOW);

      expect(due.map((row) => row.caseId).sort()).toEqual([oid('case-due')]);
    });
  });

  it('round-trips the raw document by _id as a native ObjectId, with DueDateAt mirroring DueDate', async () => {
    await repository.save(buildTracking(oid('tracking-id-guard')));

    const rawDocument = await db
      .collection<CaseSlaTrackingDocument>('case_sla_tracking')
      .findOne({ case_id: new ObjectId(oid('case-1')) });

    expect(rawDocument).not.toBeNull();
    expect(rawDocument?._id).toBeInstanceOf(ObjectId);
    expect(rawDocument?._id.toString()).toBe(oid('tracking-id-guard'));
    expect(rawDocument?.due_date.toISOString()).toBe(DUE);
  });
});
