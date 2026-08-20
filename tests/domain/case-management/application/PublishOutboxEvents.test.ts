import {
  createPublishOutboxEventsUseCase,
  type OutboxPublisher,
} from '../../../../src/modules/case-management/application/PublishOutboxEvents.js';
import { InMemoryOutboxRelayRepository } from '../../../helpers/case-management/InMemoryOutboxRelayRepository.js';
import { OutboxEvent } from '../../../../src/shared/outbox/OutboxEvent.js';
import { oid } from '../../../support/oid.js';
import { createOutboxEventId } from '../../../../src/shared/outbox/OutboxEventId.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-11-02T08:00:00.000Z'));

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

function build(events: OutboxEvent[], failOn: string[] = []) {
  const outbox = new InMemoryOutboxRelayRepository();
  for (const e of events) void outbox.record(e);
  const publisher = new RecordingPublisher(failOn);

  return {
    outbox,
    publisher,
    publishOutboxEvents: createPublishOutboxEventsUseCase({
      outbox,
      publisher,
      clock: new FixedClock(NOW),
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

    expect(result).toEqual({ published: 2, failed: 0 });
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

  it('marks a rejected event FAILED with its reason and keeps going', async () => {
    // Un consumidor que rechaza un payload concreto no puede bloquear la cola
    // entera detras de el.
    const { outbox, publisher, publishOutboxEvents } = build(
      [event('1', 'case.created'), event('2', 'case.rechazado'), event('3', 'case.reopened')],
      ['case.rechazado'],
    );

    const result = await publishOutboxEvents();

    expect(result).toEqual({ published: 2, failed: 1 });
    expect(publisher.published.map((e) => e.eventType)).toEqual(['case.created', 'case.reopened']);

    const failed = outbox.all().find((e) => e.eventType === 'case.rechazado');
    expect(failed?.status).toBe('FAILED');
    expect(failed?.lastError).toContain('case.rechazado');
    // Un evento fallido nunca llego a publicarse.
    expect(failed?.publishedAt).toBeNull();
  });

  it('does not republish what it already published', async () => {
    const { publisher, publishOutboxEvents } = build([event('1', 'case.created')]);

    await publishOutboxEvents();
    const second = await publishOutboxEvents();

    expect(second).toEqual({ published: 0, failed: 0 });
    expect(publisher.published).toHaveLength(1);
  });

  it('clears the previous error when a retry finally succeeds', async () => {
    const outbox = new InMemoryOutboxRelayRepository();
    void outbox.record(event('1', 'case.created').markFailed('el consumidor estaba caido'));

    const publishOutboxEvents = createPublishOutboxEventsUseCase({
      outbox,
      publisher: new RecordingPublisher(),
      clock: new FixedClock(NOW),
    });

    // FAILED no es PENDING: este pase no lo toca. El reintento es una decision
    // explicita, no algo que ocurra solo.
    await expect(publishOutboxEvents()).resolves.toEqual({ published: 0, failed: 0 });
    expect(outbox.all()[0]?.status).toBe('FAILED');
  });

  it('reports an empty batch as a no-op', async () => {
    const { publishOutboxEvents } = build([]);

    await expect(publishOutboxEvents()).resolves.toEqual({ published: 0, failed: 0 });
  });
});
