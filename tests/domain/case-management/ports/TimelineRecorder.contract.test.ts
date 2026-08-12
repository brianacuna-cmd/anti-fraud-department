import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { CaseTimelineEvent } from '../../../../src/modules/case-management/domain/model/aggregates/CaseTimelineEvent.js';
import { createTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildEvent(id: string): CaseTimelineEvent {
  return CaseTimelineEvent.create({
    id: createTimelineEventId(id),
    caseId: createCaseId('case-1'),
    eventType: 'CASE_CREATED',
    previousValue: null,
    newValue: null,
    createdBy: 'user-1',
    createdAt: NOW,
  });
}

describe('TimelineRecorder (port contract, via InMemoryTimelineRecorder fake)', () => {
  it('records a timeline event', async () => {
    const recorder = new InMemoryTimelineRecorder();
    await recorder.record(buildEvent('event-1'));

    expect(recorder.all()).toHaveLength(1);
    expect(recorder.all()[0]?.id).toBe('event-1');
  });

  it('records multiple independent events for the same case', async () => {
    const recorder = new InMemoryTimelineRecorder();
    await recorder.record(buildEvent('event-1'));
    await recorder.record(buildEvent('event-2'));

    expect(recorder.all()).toHaveLength(2);
  });

  it('exposes only `record` — no update/delete/replace method (spec: "CaseTimeline is append-only")', () => {
    const recorder = new InMemoryTimelineRecorder();
    const publicMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(recorder)).filter(
      (name) => name !== 'constructor',
    );

    expect(publicMethods).toEqual(expect.arrayContaining(['record']));
    expect(publicMethods).not.toEqual(
      expect.arrayContaining(['update', 'delete', 'replace', 'remove']),
    );
  });

  it('re-recording the same id is rejected, not silently overwritten (immutability guard)', async () => {
    const recorder = new InMemoryTimelineRecorder();
    await recorder.record(buildEvent('event-1'));

    await expect(recorder.record(buildEvent('event-1'))).rejects.toThrow();
    expect(recorder.all()).toHaveLength(1);
  });
});
