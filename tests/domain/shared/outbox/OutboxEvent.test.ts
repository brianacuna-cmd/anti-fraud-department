import { OutboxEvent } from '../../../../src/shared/outbox/OutboxEvent.js';
import { createOutboxEventId } from '../../../../src/shared/outbox/OutboxEventId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { oid } from '../../../support/oid.js';

const NOW = fromDate(new Date('2026-11-02T08:00:00.000Z'));
const FUTURE = fromDate(new Date('2026-11-02T08:00:30.000Z'));

function freshEvent(): OutboxEvent {
  return OutboxEvent.create({
    id: createOutboxEventId(oid('ev-1')),
    organizationId: oid('org-1'),
    eventType: 'case.created',
    aggregateType: 'case',
    aggregateId: 'case-1',
    payload: { caseId: 'case-1' },
    now: NOW,
  });
}

describe('OutboxEvent.scheduleRetry', () => {
  it('keeps PENDING, increments publishAttempts, sets nextRetryAt, clears lockedUntil', () => {
    const e = freshEvent();
    const retried = e.scheduleRetry(FUTURE);

    expect(retried.status).toBe('PENDING');
    expect(retried.publishAttempts).toBe(1);
    expect(retried.nextRetryAt).toBe(FUTURE);
    expect(retried.lockedUntil).toBeNull();
  });

  it('preserves id, organizationId, payload, createdAt and leaves publishedAt null', () => {
    const e = freshEvent();
    const retried = e.scheduleRetry(FUTURE);

    expect(retried.id).toBe(e.id);
    expect(retried.organizationId).toBe(e.organizationId);
    expect(retried.payload).toEqual(e.payload);
    expect(retried.createdAt).toBe(e.createdAt);
    expect(retried.publishedAt).toBeNull();
  });

  it('does not mutate the original event', () => {
    const e = freshEvent();
    e.scheduleRetry(FUTURE);

    expect(e.status).toBe('PENDING');
    expect(e.publishAttempts).toBe(0);
    expect(e.nextRetryAt).toBeNull();
  });

  it('accumulates attempts across repeated calls', () => {
    const e = freshEvent();
    const second = e.scheduleRetry(FUTURE).scheduleRetry(FUTURE);

    expect(second.publishAttempts).toBe(2);
  });
});

describe('OutboxEvent.markExhausted', () => {
  it('sets FAILED, increments attempts, sets lastError, clears nextRetryAt', () => {
    const e = freshEvent();
    const exhausted = e.markExhausted('broker down');

    expect(exhausted.status).toBe('FAILED');
    expect(exhausted.publishAttempts).toBe(1);
    expect(exhausted.lastError).toBe('broker down');
    expect(exhausted.nextRetryAt).toBeNull();
  });

  it('does not touch publishedAt', () => {
    const exhausted = freshEvent().markExhausted('reason');

    expect(exhausted.publishedAt).toBeNull();
  });

  it('clears nextRetryAt even when it was previously set', () => {
    const rescheduled = freshEvent().scheduleRetry(FUTURE);
    const exhausted = rescheduled.markExhausted('final error');

    expect(exhausted.nextRetryAt).toBeNull();
    expect(exhausted.publishAttempts).toBe(2);
  });

  it('stores the exact reason string', () => {
    const reason = 'TOPIC_AUTHORIZATION_FAILED topic=outbox.events';
    const exhausted = freshEvent().markExhausted(reason);

    expect(exhausted.lastError).toBe(reason);
  });
});
