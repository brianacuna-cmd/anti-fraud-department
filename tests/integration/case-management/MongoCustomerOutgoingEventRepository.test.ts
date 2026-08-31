import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoCustomerOutgoingEventRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoCustomerOutgoingEventRepository.js';
import { CustomerOutgoingEvent } from '../../../src/modules/case-management/domain/model/aggregates/CustomerOutgoingEvent.js';
import { generateCustomerOutgoingEventId } from '../../../src/modules/case-management/domain/model/value-objects/CustomerOutgoingEventId.js';
import { createEnforcementActionId } from '../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import { toDocument } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/mappers/CustomerOutgoingEventDocumentMapper.js';
import type { CustomerOutgoingEventDocument } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/documents/CustomerOutgoingEventDocument.js';
import { fromDate, type Instant } from '../../../src/shared/time/Instant.js';

jest.setTimeout(120_000);

function buildRecordedDelivery(
  status: 'SENT' | 'FAILED',
  createdAt: string,
  latencyMs: number,
): CustomerOutgoingEvent {
  return CustomerOutgoingEvent.createRecordedDelivery({
    id: generateCustomerOutgoingEventId(),
    organizationId: oid('org-1'),
    customerId: 'WEBHOOK_TEST',
    webhookUrl: 'https://example.com/webhook',
    eventType: 'WEBHOOK_TEST',
    payload: {
      event_type: 'WEBHOOK_TEST',
      organization_id: oid('org-1'),
      event_id: oid(`probe-${status}-${createdAt}`),
      requested_at: createdAt,
    },
    status,
    responseStatus: status === 'SENT' ? 200 : 500,
    latencyMs,
    now: fromDate(new Date(createdAt)),
  });
}

function buildEvent(
  label: string,
  createdAt: string,
  overrides: { attempts?: number; lastAttemptAt?: string | null } = {},
): CustomerOutgoingEvent {
  const event = CustomerOutgoingEvent.create({
    id: generateCustomerOutgoingEventId(),
    organizationId: oid('org-1'),
    customerId: 'customer-1',
    enforcementActionId: createEnforcementActionId(oid(`ea-${label}`)),
    webhookUrl: 'https://example.com/webhook',
    eventType: 'ENFORCEMENT_ACTION_CREATED',
    payload: {
      enforcement_action_id: oid(`ea-${label}`),
      case_id: oid('case-1'),
      action_type: 'BLOCK',
      target_type: 'CUSTOMER',
      target_id: 'customer-1',
      organization_id: oid('org-1'),
    },
    now: fromDate(new Date(createdAt)),
  });

  if (overrides.attempts === undefined) {
    return event;
  }

  // Rehydrate with the desired attempts/lastAttemptAt without going through
  // the aggregate's transition-guarded mutators (test fixture concern only).
  return CustomerOutgoingEvent.rehydrate({
    ...event.toProps(),
    attempts: overrides.attempts,
    lastAttemptAt:
      overrides.lastAttemptAt === undefined || overrides.lastAttemptAt === null
        ? null
        : fromDate(new Date(overrides.lastAttemptAt)),
  });
}

async function seed(
  db: Db,
  event: CustomerOutgoingEvent,
  claimedAt: Date | null = null,
): Promise<void> {
  const document: CustomerOutgoingEventDocument = { ...toDocument(event), claimed_at: claimedAt };
  await db.collection<CustomerOutgoingEventDocument>('customer_outgoing_events').insertOne(document);
}

describe('MongoCustomerOutgoingEventRepository (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoCustomerOutgoingEventRepository;

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
    repository = new MongoCustomerOutgoingEventRepository(db);
  });

  afterEach(async () => {
    await db.collection('customer_outgoing_events').deleteMany({});
  });

  it('never returns overlapping events for two concurrent claimPending calls (REQ-C1)', async () => {
    await seed(db, buildEvent('a', '2026-01-01T00:00:00.000Z'));
    await seed(db, buildEvent('b', '2026-01-01T00:00:01.000Z'));
    await seed(db, buildEvent('c', '2026-01-01T00:00:02.000Z'));

    const now = fromDate(new Date('2026-01-01T00:10:00.000Z'));

    const [first, second] = await Promise.all([
      repository.claimPending(now, 3),
      repository.claimPending(now, 3),
    ]);

    const firstIds = first.map((e) => e.id);
    const secondIds = second.map((e) => e.id);
    const overlap = firstIds.filter((id) => secondIds.includes(id));

    expect(overlap).toEqual([]);
    expect(firstIds.length + secondIds.length).toBe(3);
  });

  it('excludes an event still within its backoff window (REQ-C2.1)', async () => {
    const notDueYet = buildEvent('not-due', '2026-01-01T00:00:00.000Z', {
      attempts: 0,
      lastAttemptAt: '2026-01-01T00:10:00.500Z',
    });
    await seed(db, notDueYet);

    const now: Instant = fromDate(new Date('2026-01-01T00:10:01.000Z'));

    const claimed = await repository.claimPending(now, 10);

    expect(claimed).toHaveLength(0);
  });

  it('claims an event once its backoff window has elapsed (REQ-C2.2)', async () => {
    const due = buildEvent('due', '2026-01-01T00:00:00.000Z', {
      attempts: 0,
      lastAttemptAt: '2026-01-01T00:10:00.000Z',
    });
    await seed(db, due);

    const now: Instant = fromDate(new Date('2026-01-01T00:10:01.500Z'));

    const claimed = await repository.claimPending(now, 10);

    expect(claimed.map((e) => e.id)).toEqual([due.id]);
  });

  it('bounds the claim to the requested limit at the query level (REQ-C3)', async () => {
    await seed(db, buildEvent('a', '2026-01-01T00:00:00.000Z'));
    await seed(db, buildEvent('b', '2026-01-01T00:00:01.000Z'));
    await seed(db, buildEvent('c', '2026-01-01T00:00:02.000Z'));

    const now = fromDate(new Date('2026-01-01T00:10:00.000Z'));

    const claimed = await repository.claimPending(now, 2);

    expect(claimed).toHaveLength(2);
  });

  it('re-claims an event whose lease has expired without a save (crash recovery)', async () => {
    const event = buildEvent('crashed', '2026-01-01T00:00:00.000Z');
    // Simulate a prior claimer that crashed: claimed_at is stale (older than the 5-minute lease TTL).
    await seed(db, event, new Date('2026-01-01T00:00:00.000Z'));

    const now = fromDate(new Date('2026-01-01T00:06:00.000Z'));

    const claimed = await repository.claimPending(now, 10);

    expect(claimed.map((e) => e.id)).toEqual([event.id]);
  });

  it('does not re-claim an event whose lease is still active', async () => {
    const event = buildEvent('leased', '2026-01-01T00:00:00.000Z');
    await seed(db, event, new Date('2026-01-01T00:04:00.000Z'));

    const now = fromDate(new Date('2026-01-01T00:06:00.000Z'));

    const claimed = await repository.claimPending(now, 10);

    expect(claimed).toHaveLength(0);
  });

  it('drops claimed_at on save, releasing the lease (markSent regression)', async () => {
    const event = buildEvent('to-send', '2026-01-01T00:00:00.000Z');
    await seed(db, event, new Date('2026-01-01T00:00:00.000Z'));

    const sent = event.markSent({ responseStatus: 200, now: fromDate(new Date('2026-01-01T00:10:00.000Z')) });
    await repository.save(sent);

    const raw = await db
      .collection<CustomerOutgoingEventDocument>('customer_outgoing_events')
      .findOne({ _id: raw_id(event) });
    expect(raw?.claimed_at ?? null).toBeNull();
    expect(raw?.status).toBe('SENT');
  });

  it('persists WEBHOOK_TEST rows with null enforcement_action_id and latency_ms', async () => {
    const event = buildRecordedDelivery('SENT', '2026-01-01T00:00:00.000Z', 42);

    await repository.save(event);

    const loaded = await repository.findById(event.id);
    expect(loaded?.enforcementActionId).toBeNull();
    expect(loaded?.latencyMs).toBe(42);
    expect(loaded?.status).toBe('SENT');

    const raw = await db
      .collection<CustomerOutgoingEventDocument>('customer_outgoing_events')
      .findOne({ _id: raw_id(event) });
    expect(raw?.enforcement_action_id).toBeNull();
    expect(raw?.latency_ms).toBe(42);
  });

  it('rehydrates a missing latency_ms field as null so pre-probe rows still read', async () => {
    const event = buildEvent('legacy-latency', '2026-01-01T00:00:00.000Z');
    const document = toDocument(event);
    const { latency_ms: _omitted, ...withoutLatency } = document as CustomerOutgoingEventDocument & {
      readonly latency_ms?: number | null;
    };
    await db.collection<CustomerOutgoingEventDocument>('customer_outgoing_events').insertOne(withoutLatency);

    const loaded = await repository.findById(event.id);

    expect(loaded?.latencyMs).toBeNull();
    expect(loaded?.enforcementActionId).toBe(event.enforcementActionId);
  });

  it('does not claim SENT or FAILED WEBHOOK_TEST rows (claimPending stays PENDING-only)', async () => {
    const sent = buildRecordedDelivery('SENT', '2026-01-01T00:00:00.000Z', 9);
    const failed = buildRecordedDelivery('FAILED', '2026-01-01T00:00:01.000Z', 11);
    const pending = buildEvent('still-pending', '2026-01-01T00:00:02.000Z');
    await repository.save(sent);
    await repository.save(failed);
    await repository.save(pending);

    const claimed = await repository.claimPending(fromDate(new Date('2026-01-01T00:10:00.000Z')), 10);

    expect(claimed.map((row) => row.id)).toEqual([pending.id]);
  });
});

function raw_id(event: CustomerOutgoingEvent): import('mongodb').ObjectId {
  const { ObjectId } = require('mongodb') as typeof import('mongodb');
  return new ObjectId(event.id);
}
