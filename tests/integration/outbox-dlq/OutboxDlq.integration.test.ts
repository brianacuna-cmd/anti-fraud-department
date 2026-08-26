import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { ObjectId } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoUnitOfWork } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { MongoOutboxEventRepository } from '../../../src/shared/outbox/mongo/MongoOutboxEventRepository.js';
import { MongoOutboxDlqRepository } from '../../../src/shared/outbox/mongo/MongoOutboxDlqRepository.js';
import { OutboxEvent } from '../../../src/shared/outbox/OutboxEvent.js';
import { DeadLetterEvent } from '../../../src/shared/outbox/DeadLetterEvent.js';
import { generateOutboxEventId } from '../../../src/shared/outbox/OutboxEventId.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { oid } from '../../support/oid.js';

jest.setTimeout(60_000);

const ORG_ID = oid('org-dlq-1');
const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const FUTURE = fromDate(new Date('2026-01-01T01:00:00.000Z'));

function makeEvent(): OutboxEvent {
  return OutboxEvent.create({
    id: generateOutboxEventId(),
    organizationId: ORG_ID,
    eventType: 'case.resolved',
    aggregateType: 'Case',
    aggregateId: oid('case-dlq-1'),
    payload: { test: true },
    now: NOW,
  });
}

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
let outboxRepo: MongoOutboxEventRepository;
let dlqRepo: MongoOutboxDlqRepository;
let unitOfWork: MongoUnitOfWork;

beforeAll(async () => {
  replSet = await startReplicaSetMongo();
  const uri = replSet.getUri();
  ({ client, db } = await connectMongo(uri, 'test_outbox_dlq'));
  await ensureIndexes(db);
  outboxRepo = new MongoOutboxEventRepository(db);
  dlqRepo = new MongoOutboxDlqRepository(db);
  unitOfWork = new MongoUnitOfWork(client);
});

afterAll(async () => {
  await client.close();
  await replSet.stop();
});

beforeEach(async () => {
  await db.collection('outbox_events').deleteMany({});
  await db.collection('dead_letter_queue').deleteMany({});
});

describe('atomic move to DLQ', () => {
  it('removes the row from outbox_events and inserts it into dead_letter_queue atomically', async () => {
    const event = makeEvent();
    await outboxRepo.save(event);

    const exhausted = event.markExhausted('permanent kafka failure');
    const dead = DeadLetterEvent.from(exhausted, NOW);

    await unitOfWork.withTransaction(async (tx) => {
      await dlqRepo.save(dead, tx);
      await outboxRepo.delete(event.id, tx);
    });

    // Row must be gone from outbox_events
    const pendingAfter = await outboxRepo.findPending(NOW);
    expect(pendingAfter.find((e) => e.id === event.id)).toBeUndefined();

    // Row must be present in dead_letter_queue with correct shape
    const dlqDoc = await db
      .collection('dead_letter_queue')
      .findOne({ _id: new ObjectId(event.id as string) });
    expect(dlqDoc).not.toBeNull();
    expect(dlqDoc!.reason).toBe('permanent kafka failure');
    expect(dlqDoc!.organization_id).toStrictEqual(new ObjectId(ORG_ID));
    expect(dlqDoc!.exhausted_at).toBeInstanceOf(Date);
  });
});

describe('idempotent re-move (E11000 swallow)', () => {
  it('does not duplicate the DLQ entry when save is called twice for the same event id', async () => {
    const event = makeEvent();
    await outboxRepo.save(event);

    const exhausted = event.markExhausted('poison payload');
    const dead = DeadLetterEvent.from(exhausted, NOW);

    // First move — atomic
    await unitOfWork.withTransaction(async (tx) => {
      await dlqRepo.save(dead, tx);
      await outboxRepo.delete(event.id, tx);
    });

    // Second call — must not throw (E11000 swallowed)
    await expect(dlqRepo.save(dead)).resolves.toBeUndefined();

    // Only one DLQ document for this event id
    const count = await db
      .collection('dead_letter_queue')
      .countDocuments({ _id: new ObjectId(event.id as string) });
    expect(count).toBe(1);
  });
});

describe('findPending due-time gate against real BSON Date', () => {
  it('excludes events whose nextRetryAt is in the future', async () => {
    const immediate = makeEvent();
    const deferred = OutboxEvent.rehydrate({
      ...makeEvent().toProps(),
      nextRetryAt: FUTURE, // after NOW
    });

    await outboxRepo.save(immediate);
    await outboxRepo.save(deferred);

    const pending = await outboxRepo.findPending(NOW);

    expect(pending.some((e) => e.id === immediate.id)).toBe(true);
    expect(pending.some((e) => e.id === deferred.id)).toBe(false);
  });

  it('includes events whose nextRetryAt is null', async () => {
    const event = makeEvent(); // nextRetryAt starts null
    await outboxRepo.save(event);

    const pending = await outboxRepo.findPending(NOW);

    expect(pending.some((e) => e.id === event.id)).toBe(true);
  });
});
