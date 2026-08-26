import {
  createPublishOutboxEventsUseCase,
  type OutboxPublisher,
} from '../../../../src/modules/case-management/application/PublishOutboxEvents.js';
import { InMemoryOutboxRelayRepository } from '../../../helpers/case-management/InMemoryOutboxRelayRepository.js';
import { InMemoryOutboxDlqRepository } from '../../../helpers/case-management/InMemoryOutboxDlqRepository.js';
import {
  InMemoryUnitOfWork,
  ThrowingUnitOfWork,
} from '../../../helpers/case-management/InMemoryUnitOfWork.js';
import { OutboxEvent } from '../../../../src/shared/outbox/OutboxEvent.js';
import { DeadLetterEvent } from '../../../../src/shared/outbox/DeadLetterEvent.js';
import { createOutboxEventId } from '../../../../src/shared/outbox/OutboxEventId.js';
import { createOutboxRetryPolicy } from '../../../../src/shared/outbox/OutboxRetryPolicy.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { oid } from '../../../support/oid.js';
import { FixedClock } from '../../../helpers/FixedClock.js';

const NOW = fromDate(new Date('2026-11-02T08:00:00.000Z'));
const PAST = fromDate(new Date('2026-11-02T07:59:00.000Z'));

const RETRY_POLICY = createOutboxRetryPolicy({});
const FIXED_RNG = () => 1; // deterministic: delay = base * 1000 ms

class RecordingPublisher implements OutboxPublisher {
  public readonly published: OutboxEvent[] = [];
  constructor(private readonly failOn: string[] = []) {}
  async publish(event: OutboxEvent): Promise<void> {
    if (this.failOn.includes(event.eventType)) throw new Error(`consumidor rechazo ${event.eventType}`);
    this.published.push(event);
  }
}

function event(id: string, eventType: string) {
  return OutboxEvent.create({
    id: createOutboxEventId(oid(id)),
    organizationId: oid('org-1'),
    aggregateType: 'case',
    aggregateId: `case-${id}`,
    eventType,
    payload: { caseId: `case-${id}` },
    now: NOW,
  });
}

function pendingAttempted(id: string, attempts: number, eventType = 'case.retry') {
  return OutboxEvent.rehydrate({
    id: createOutboxEventId(oid(id)),
    organizationId: oid('org-1'),
    eventType,
    aggregateType: 'case',
    aggregateId: `case-${id}`,
    payload: { caseId: `case-${id}` },
    status: 'PENDING',
    publishAttempts: attempts,
    lastError: attempts > 0 ? 'previous error' : null,
    publishedAt: null,
    nextRetryAt: PAST,
    lockedUntil: null,
    createdAt: PAST,
  });
}

interface BuildOptions {
  failOn?: string[];
  rng?: () => number;
  dlq?: InMemoryOutboxDlqRepository;
  unitOfWork?: InMemoryUnitOfWork | ThrowingUnitOfWork;
}

function build(events: OutboxEvent[], options: BuildOptions = {}) {
  const outbox = new InMemoryOutboxRelayRepository();
  for (const e of events) void outbox.record(e);
  const publisher = new RecordingPublisher(options.failOn);
  const dlq = options.dlq ?? new InMemoryOutboxDlqRepository();
  const unitOfWork = options.unitOfWork ?? new InMemoryUnitOfWork();

  return {
    outbox,
    publisher,
    dlq,
    publishOutboxEvents: createPublishOutboxEventsUseCase({
      outbox,
      publisher,
      clock: new FixedClock(NOW),
      dlq,
      unitOfWork,
      retryPolicy: RETRY_POLICY,
      rng: options.rng ?? FIXED_RNG,
    }),
  };
}

describe('createPublishOutboxEventsUseCase', () => {
  it('publishes every pending event and marks it PUBLISHED', async () => {
    const { outbox, publisher, publishOutboxEvents } = build([
      event('1', 'case.created'),
      event('2', 'case.reopened'),
    ]);

    const result = await publishOutboxEvents();

    expect(result).toEqual({ published: 2, failed: 0, retried: 0, deadLettered: 0 });
    expect(publisher.published).toHaveLength(2);
    expect(outbox.all().every((e) => e.status === 'PUBLISHED')).toBe(true);
    expect(outbox.all()[0]?.publishedAt).toBe(NOW);
  });

  it('publishes oldest first so a consumer never sees an effect before its cause', async () => {
    const { publisher, publishOutboxEvents } = build([
      event('1', 'case.created'),
      event('2', 'case.reopened'),
    ]);

    await publishOutboxEvents();

    expect(publisher.published.map((e) => e.eventType)).toEqual(['case.created', 'case.reopened']);
  });

  it('reschedules a failed event as PENDING on first failure (retried=1, deadLettered=0)', async () => {
    const { outbox, publisher, publishOutboxEvents } = build(
      [event('1', 'case.created'), event('2', 'case.rechazado'), event('3', 'case.reopened')],
      { failOn: ['case.rechazado'] },
    );

    const result = await publishOutboxEvents();

    expect(result).toEqual({ published: 2, failed: 1, retried: 1, deadLettered: 0 });
    expect(publisher.published.map((e) => e.eventType)).toEqual(['case.created', 'case.reopened']);

    const rescheduled = outbox.all().find((e) => e.eventType === 'case.rechazado');
    expect(rescheduled?.status).toBe('PENDING');
    expect(rescheduled?.publishAttempts).toBe(1);
    expect(rescheduled?.nextRetryAt).not.toBeNull();
    expect(rescheduled?.publishedAt).toBeNull();
  });

  it('does not republish what it already published', async () => {
    const { publisher, publishOutboxEvents } = build([event('1', 'case.created')]);

    await publishOutboxEvents();
    const second = await publishOutboxEvents();

    expect(second).toEqual({ published: 0, failed: 0, retried: 0, deadLettered: 0 });
    expect(publisher.published).toHaveLength(1);
  });

  it('does not pick up a PENDING event whose nextRetryAt is still in the future', async () => {
    const future = fromDate(new Date('2026-11-02T08:05:00.000Z'));
    const notDue = OutboxEvent.rehydrate({
      id: createOutboxEventId(oid('1')),
      organizationId: oid('org-1'),
      eventType: 'case.created',
      aggregateType: 'case',
      aggregateId: 'case-1',
      payload: { caseId: 'case-1' },
      status: 'PENDING',
      publishAttempts: 1,
      lastError: 'broker down',
      publishedAt: null,
      nextRetryAt: future,
      lockedUntil: null,
      createdAt: PAST,
    });
    const { publisher, publishOutboxEvents } = build([notDue]);

    const result = await publishOutboxEvents();

    expect(result).toEqual({ published: 0, failed: 0, retried: 0, deadLettered: 0 });
    expect(publisher.published).toHaveLength(0);
  });

  it('does not pick up a FAILED event left by markFailed (stays out of PENDING sweep)', async () => {
    const outbox = new InMemoryOutboxRelayRepository();
    void outbox.record(event('1', 'case.created').markFailed('el consumidor estaba caido'));

    const dlq = new InMemoryOutboxDlqRepository();
    const unitOfWork = new InMemoryUnitOfWork();
    const publishOutboxEvents = createPublishOutboxEventsUseCase({
      outbox,
      publisher: new RecordingPublisher(),
      clock: new FixedClock(NOW),
      dlq,
      unitOfWork,
      retryPolicy: RETRY_POLICY,
      rng: FIXED_RNG,
    });

    await expect(publishOutboxEvents()).resolves.toEqual({ published: 0, failed: 0, retried: 0, deadLettered: 0 });
    expect(outbox.all()[0]?.status).toBe('FAILED');
  });

  it('reports an empty batch as a no-op', async () => {
    const { publishOutboxEvents } = build([]);

    await expect(publishOutboxEvents()).resolves.toEqual({ published: 0, failed: 0, retried: 0, deadLettered: 0 });
  });

  it('moves event to DLQ on 5th failure and removes it from outbox (deadLettered=1)', async () => {
    const exhaustedEvent = pendingAttempted('1', 4); // publishAttempts=4, next = 5th failure
    const { outbox, dlq, publishOutboxEvents } = build(
      [exhaustedEvent],
      { failOn: ['case.retry'] },
    );

    const result = await publishOutboxEvents();

    expect(result).toEqual({ published: 0, failed: 1, retried: 0, deadLettered: 1 });
    expect(dlq.all()).toHaveLength(1);
    expect(dlq.all()[0]?.id).toBe(exhaustedEvent.id);
    const remaining = outbox.all().filter((e) => e.id === exhaustedEvent.id);
    expect(remaining).toHaveLength(0);
  });

  it('clears lastError when a rescheduled event finally publishes successfully', async () => {
    const retriedEvent = pendingAttempted('1', 1, 'case.created');
    const { outbox, publishOutboxEvents } = build([retriedEvent]);

    const result = await publishOutboxEvents();

    expect(result).toEqual({ published: 1, failed: 0, retried: 0, deadLettered: 0 });
    const published = outbox.all().find((e) => e.id === retriedEvent.id);
    expect(published?.status).toBe('PUBLISHED');
    expect(published?.lastError).toBeNull();
    expect(published?.publishedAt).toBe(NOW);
  });

  it('leaves outbox row intact when transaction aborts before dlq.save and outbox.delete', async () => {
    const exhaustedEvent = pendingAttempted('1', 4);
    const { outbox, dlq, publishOutboxEvents } = build(
      [exhaustedEvent],
      { failOn: ['case.retry'], unitOfWork: new ThrowingUnitOfWork() },
    );

    const result = await publishOutboxEvents();

    expect(result).toEqual({ published: 0, failed: 1, retried: 0, deadLettered: 0 });
    expect(dlq.all()).toHaveLength(0);
    const row = outbox.all().find((e) => e.id === exhaustedEvent.id);
    expect(row).toBeDefined();
  });

  it('completes idempotently if DLQ already has the entry (E11000 no-op)', async () => {
    const exhaustedEvent = pendingAttempted('1', 4);
    const { outbox, dlq, publishOutboxEvents } = build(
      [exhaustedEvent],
      { failOn: ['case.retry'] },
    );

    // Pre-seed DLQ: simulates a prior aborted move where dlq.save committed
    // but outbox.delete did not (the row is still in outbox).
    const priorExhausted = exhaustedEvent.markExhausted('previous failure');
    await dlq.save(DeadLetterEvent.from(priorExhausted, NOW));
    expect(dlq.all()).toHaveLength(1);

    const result = await publishOutboxEvents();

    expect(result).toEqual({ published: 0, failed: 1, retried: 0, deadLettered: 1 });
    expect(dlq.all()).toHaveLength(1); // no duplicate
    const row = outbox.all().find((e) => e.id === exhaustedEvent.id);
    expect(row).toBeUndefined(); // deleted
  });
});
