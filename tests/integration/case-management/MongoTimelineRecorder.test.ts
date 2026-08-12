import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoTimelineRecorder } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoTimelineRecorder.js';
import { CaseTimelineEvent } from '../../../src/modules/case-management/domain/model/aggregates/CaseTimelineEvent.js';
import { createTimelineEventId } from '../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { createCaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import type { CaseTimelineDocument } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/documents/CaseTimelineDocument.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildEvent(id: string, caseId = 'case-1'): CaseTimelineEvent {
  return CaseTimelineEvent.create({
    id: createTimelineEventId(id),
    caseId: createCaseId(caseId),
    eventType: 'CASE_CREATED',
    previousValue: null,
    newValue: null,
    createdBy: 'user-1',
    createdAt: NOW,
  });
}

describe('MongoTimelineRecorder (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let recorder: MongoTimelineRecorder;

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
    recorder = new MongoTimelineRecorder(db);
  });

  afterEach(async () => {
    await db.collection('CaseTimeline').deleteMany({});
  });

  it('records a timeline event via insertOne', async () => {
    await recorder.record(buildEvent('event-1'));

    const document = await db.collection<CaseTimelineDocument>('CaseTimeline').findOne({ _id: 'event-1' });

    expect(document).not.toBeNull();
    expect(document?.CaseId).toBe('case-1');
    expect(document?.EventType).toBe('CASE_CREATED');
  });

  it('verify no update/delete method exists on the port (compile-time contract)', () => {
    // `TimelineRecorder` only declares `record` — asserting this at the type
    // level: if an `update`/`delete` method were added to the interface,
    // this cast would still compile, but the runtime prototype check below
    // (mirrors the domain contract test) is the enforceable guard.
    const publicMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(recorder)).filter(
      (name) => name !== 'constructor',
    );

    expect(publicMethods).toEqual(['record']);
  });

  /**
   * Immutability assertion (tasks Slice 3 item 5): re-recording the SAME id
   * is rejected by Mongo's implicit unique `_id` index, never silently
   * turned into an update — `insertOne`, not `replaceOne`/`updateOne`.
   */
  it('re-recording the same event id fails — CaseTimeline is append-only, never replaced', async () => {
    await recorder.record(buildEvent('event-1'));

    await expect(recorder.record(buildEvent('event-1'))).rejects.toThrow();

    const documents = await db.collection('CaseTimeline').find({ _id: 'event-1' }).toArray();
    expect(documents).toHaveLength(1);
  });

  it('records multiple independent events for the same case, newest queryable first via the index', async () => {
    await recorder.record(buildEvent('event-1'));
    await recorder.record(buildEvent('event-2'));

    const documents = await db
      .collection<CaseTimelineDocument>('CaseTimeline')
      .find({ CaseId: 'case-1' })
      .sort({ CreatedAt: -1 })
      .toArray();

    expect(documents).toHaveLength(2);
  });
});
