import { CaseTimelineEvent } from '../../../../../src/modules/case-management/domain/model/aggregates/CaseTimelineEvent.js';
import { createTimelineEventId } from '../../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { createCaseId } from '../../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildEvent(
  overrides: Partial<Parameters<typeof CaseTimelineEvent.create>[0]> = {},
): CaseTimelineEvent {
  return CaseTimelineEvent.create({
    id: createTimelineEventId('event-1'),
    caseId: createCaseId('case-1'),
    eventType: 'CASE_CREATED',
    previousValue: null,
    newValue: null,
    createdBy: 'user-1',
    createdAt: NOW,
    ...overrides,
  });
}

describe('CaseTimelineEvent.create', () => {
  it('creates an event with all fields set', () => {
    const event = buildEvent();

    expect(event.caseId).toBe('case-1');
    expect(event.eventType).toBe('CASE_CREATED');
    expect(event.previousValue).toBeNull();
    expect(event.newValue).toBeNull();
    expect(event.createdBy).toBe('user-1');
    expect(event.createdAt).toBe(NOW);
  });

  it('accepts previousValue/newValue for a STATE_CHANGED event', () => {
    const event = buildEvent({
      eventType: 'STATE_CHANGED',
      previousValue: 'OPEN',
      newValue: 'IN_REVIEW',
    });

    expect(event.previousValue).toBe('OPEN');
    expect(event.newValue).toBe('IN_REVIEW');
  });

  it('accepts a null createdBy (system-triggered event)', () => {
    const event = buildEvent({ createdBy: null });

    expect(event.createdBy).toBeNull();
  });
});

describe('CaseTimelineEvent.rehydrate', () => {
  it('reconstructs from persisted props without validation', () => {
    const event = buildEvent();
    const rehydrated = CaseTimelineEvent.rehydrate(event.toProps());

    expect(rehydrated.id).toBe(event.id);
    expect(rehydrated.caseId).toBe(event.caseId);
    expect(rehydrated.eventType).toBe(event.eventType);
  });
});

describe('CaseTimelineEvent immutability (spec: "CaseTimeline is append-only")', () => {
  it('exposes no mutation methods — only create/rehydrate and getters', () => {
    const event = buildEvent();
    const prototypeMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(event)).filter(
      (name) => name !== 'constructor' && name !== 'toProps' && !name.startsWith('get '),
    );

    // Only accessor (getter) properties are allowed on the instance prototype
    // besides `toProps` — no `update`/`transitionTo`/`delete`/etc.
    for (const name of prototypeMethods) {
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(event), name);
      expect(descriptor?.get).toBeDefined();
    }
  });
});
