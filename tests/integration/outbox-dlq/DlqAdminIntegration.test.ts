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
import { fromDate, toDate } from '../../../src/shared/time/Instant.js';
import { decodeDescCursor } from '../../../src/shared/http/pagination.js';
import { oid } from '../../support/oid.js';

jest.setTimeout(60_000);

const ORG_A = oid('org-dlq-admin-a');
const ORG_B = oid('org-dlq-admin-b');
const T0 = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const T1 = fromDate(new Date('2026-01-01T01:00:00.000Z'));
const T2 = fromDate(new Date('2026-01-01T02:00:00.000Z'));

function makeDead(orgId: string, exhaustedAt = T1, reason = 'test failure'): DeadLetterEvent {
  const event = OutboxEvent.create({
    id: generateOutboxEventId(),
    organizationId: orgId,
    eventType: 'case.resolved',
    aggregateType: 'Case',
    aggregateId: oid('case-1'),
    payload: { secret: 'data', nested: true },
    now: T0,
  });
  const exhausted = event.markExhausted(reason);
  return DeadLetterEvent.from(exhausted, exhaustedAt);
}

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
let dlqRepo: MongoOutboxDlqRepository;
let outboxRepo: MongoOutboxEventRepository;
let unitOfWork: MongoUnitOfWork;

beforeAll(async () => {
  replSet = await startReplicaSetMongo();
  ({ client, db } = await connectMongo(replSet.getUri(), 'test_dlq_admin'));
  await ensureIndexes(db);
  dlqRepo = new MongoOutboxDlqRepository(db);
  outboxRepo = new MongoOutboxEventRepository(db);
  unitOfWork = new MongoUnitOfWork(client);
});

afterAll(async () => {
  await client.close();
  await replSet.stop();
});

beforeEach(async () => {
  await db.collection('dead_letter_queue').deleteMany({});
  await db.collection('outbox_events').deleteMany({});
});

// ──────────────────────────────────────────────────────────────────────────────
// findMany — Task 5.1 / 4.1 RED
// ──────────────────────────────────────────────────────────────────────────────

describe('MongoOutboxDlqRepository.findMany', () => {
  it('returns empty page when no rows exist', async () => {
    const page = await dlqRepo.findMany({ limit: 10 });

    expect(page.items).toHaveLength(0);
    expect(page.nextCursor).toBeNull();
  });

  it('returns rows in DESC exhausted_at order', async () => {
    const older = makeDead(ORG_A, T1);
    const newer = makeDead(ORG_A, T2);
    await dlqRepo.save(older);
    await dlqRepo.save(newer);

    const page = await dlqRepo.findMany({ limit: 10 });

    expect(page.items).toHaveLength(2);
    // newest first
    expect(page.items[0]!.id).toBe(newer.id);
    expect(page.items[1]!.id).toBe(older.id);
  });

  it('sets nextCursor when more rows exist than limit', async () => {
    const d1 = makeDead(ORG_A, T1);
    const d2 = makeDead(ORG_A, T2);
    await dlqRepo.save(d1);
    await dlqRepo.save(d2);

    const page = await dlqRepo.findMany({ limit: 1 });

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    // nextCursor must decode to the last item returned
    const decoded = decodeDescCursor(page.nextCursor!);
    expect(decoded).not.toBeNull();
    expect(decoded!.id).toBe(page.items[0]!.id);
  });

  it('uses cursor to navigate to the next page (keyset stability)', async () => {
    const d1 = makeDead(ORG_A, T1);
    const d2 = makeDead(ORG_A, T2);
    await dlqRepo.save(d1);
    await dlqRepo.save(d2);

    const page1 = await dlqRepo.findMany({ limit: 1 });
    expect(page1.items).toHaveLength(1);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await dlqRepo.findMany({ limit: 1, cursor: page1.nextCursor! });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();

    // page1 + page2 cover both items without overlap, in DESC order
    expect(page1.items[0]!.id).toBe(d2.id);
    expect(page2.items[0]!.id).toBe(d1.id);
  });

  it('cursor is stable across timestamp ties (tiebreak by _id DESC)', async () => {
    // Insert two events at the same exhausted_at — tiebreak is by _id DESC
    const same = makeDead(ORG_A, T1);
    const same2 = makeDead(ORG_A, T1);
    await dlqRepo.save(same);
    await dlqRepo.save(same2);

    const page1 = await dlqRepo.findMany({ limit: 1 });
    const page2 = await dlqRepo.findMany({ limit: 1, cursor: page1.nextCursor! });

    const ids = [page1.items[0]!.id, page2.items[0]!.id];
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain(same.id);
    expect(ids).toContain(same2.id);
  });

  it('filters by organizationId when provided', async () => {
    const forA = makeDead(ORG_A, T1);
    const forB = makeDead(ORG_B, T2);
    await dlqRepo.save(forA);
    await dlqRepo.save(forB);

    const page = await dlqRepo.findMany({ limit: 10, organizationId: ORG_A });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.organizationId).toBe(ORG_A);
  });

  it('returns null nextCursor on the last page', async () => {
    await dlqRepo.save(makeDead(ORG_A, T1));

    const page = await dlqRepo.findMany({ limit: 10 });

    expect(page.nextCursor).toBeNull();
  });

  it('maps documents back to DeadLetterEvent domain objects correctly', async () => {
    const dead = makeDead(ORG_A, T1, 'kafka timeout');
    await dlqRepo.save(dead);

    const page = await dlqRepo.findMany({ limit: 10 });
    const returned = page.items[0]!;

    expect(returned.id).toBe(dead.id);
    expect(returned.organizationId).toBe(dead.organizationId);
    expect(returned.reason).toBe('kafka timeout');
    expect(returned.publishAttempts).toBe(dead.publishAttempts);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// findById — Task 5.1 / 4.1 RED
// ──────────────────────────────────────────────────────────────────────────────

describe('MongoOutboxDlqRepository.findById', () => {
  it('returns the DeadLetterEvent when the id exists', async () => {
    const dead = makeDead(ORG_A, T1);
    await dlqRepo.save(dead);

    const found = await dlqRepo.findById(dead.id);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(dead.id);
    expect(found!.reason).toBe(dead.reason);
    expect(found!.payload).toStrictEqual(dead.payload);
  });

  it('returns null when the id does not exist', async () => {
    const nonExistent = generateOutboxEventId();
    const result = await dlqRepo.findById(nonExistent);
    expect(result).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// delete — Task 5.1 / 4.1 RED
// ──────────────────────────────────────────────────────────────────────────────

describe('MongoOutboxDlqRepository.delete', () => {
  it('removes the document from the collection', async () => {
    const dead = makeDead(ORG_A, T1);
    await dlqRepo.save(dead);

    await dlqRepo.delete(dead.id);

    const inDb = await db
      .collection('dead_letter_queue')
      .findOne({ _id: new ObjectId(dead.id as string) });
    expect(inDb).toBeNull();
  });

  it('is idempotent: no error when the row is already absent', async () => {
    const nonExistent = generateOutboxEventId();
    await expect(dlqRepo.delete(nonExistent)).resolves.toBeUndefined();
  });

  it('participates in transactions (rollback leaves row intact)', async () => {
    const dead = makeDead(ORG_A, T1);
    await dlqRepo.save(dead);

    // Simulate a rollback by throwing inside withTransaction
    await expect(
      unitOfWork.withTransaction(async (tx) => {
        await dlqRepo.delete(dead.id, tx);
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');

    // Row must still be there after rollback
    const inDb = await db
      .collection('dead_letter_queue')
      .findOne({ _id: new ObjectId(dead.id as string) });
    expect(inDb).not.toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Requeue atomicity — Task 5.1 RED
// ──────────────────────────────────────────────────────────────────────────────

describe('requeue atomicity', () => {
  it('rollback leaves both dead_letter_queue and outbox_events untouched', async () => {
    const dead = makeDead(ORG_A, T1);
    await dlqRepo.save(dead);

    const newId = generateOutboxEventId();
    const requeued = OutboxEvent.create({
      id: newId,
      organizationId: ORG_A,
      eventType: dead.eventType,
      aggregateType: dead.aggregateType,
      aggregateId: dead.aggregateId,
      payload: dead.payload,
      now: T0,
    });

    await expect(
      unitOfWork.withTransaction(async (tx) => {
        await dlqRepo.delete(dead.id, tx);
        await outboxRepo.save(requeued, tx);
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');

    // DLQ row must still be present
    const dlqDoc = await db
      .collection('dead_letter_queue')
      .findOne({ _id: new ObjectId(dead.id as string) });
    expect(dlqDoc).not.toBeNull();

    // Outbox row must NOT be present
    const outboxDoc = await db
      .collection('outbox_events')
      .findOne({ _id: new ObjectId(newId as string) });
    expect(outboxDoc).toBeNull();
  });

  it('re-exhausted event enters DLQ under the NEW outbox id, not the original DLQ id', async () => {
    // Step 1: place an event in DLQ
    const originalDead = makeDead(ORG_A, T1);
    await dlqRepo.save(originalDead);

    // Step 2: requeue atomically
    const newId = generateOutboxEventId();
    const requeued = OutboxEvent.create({
      id: newId,
      organizationId: ORG_A,
      eventType: originalDead.eventType,
      aggregateType: originalDead.aggregateType,
      aggregateId: originalDead.aggregateId,
      payload: originalDead.payload,
      now: T0,
    });

    await unitOfWork.withTransaction(async (tx) => {
      await dlqRepo.delete(originalDead.id, tx);
      await outboxRepo.save(requeued, tx);
    });

    // Step 3: simulate the new outbox event exhausting again
    const exhaustedAgain = requeued.markExhausted('second kafka failure');
    const deadAgain = DeadLetterEvent.from(exhaustedAgain, T2);
    await unitOfWork.withTransaction(async (tx) => {
      await dlqRepo.save(deadAgain, tx);
      await outboxRepo.delete(newId, tx);
    });

    // The NEW DLQ entry must use the new outbox id, NOT the original DLQ id
    expect(deadAgain.id).toBe(newId);
    expect(deadAgain.id).not.toBe(originalDead.id);

    // The new DLQ entry must be present under the new id
    const newDlqDoc = await db
      .collection('dead_letter_queue')
      .findOne({ _id: new ObjectId(newId as string) });
    expect(newDlqDoc).not.toBeNull();

    // The original DLQ entry must NOT be present (it was deleted during requeue)
    const originalDlqDoc = await db
      .collection('dead_letter_queue')
      .findOne({ _id: new ObjectId(originalDead.id as string) });
    expect(originalDlqDoc).toBeNull();
  });
});
