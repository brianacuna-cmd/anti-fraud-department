import { createTimelineEventType } from '../../../../../src/modules/case-management/domain/model/value-objects/TimelineEventType.js';
import { CaseManagementError } from '../../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

describe('createTimelineEventType', () => {
  it.each([
    'STATE_CHANGED',
    'ASSIGNED',
    'NOTE_ADDED',
    'DECISION_MADE',
    'CASE_CREATED',
    'CASE_REOPENED',
  ])('accepts %s', (value) => {
    expect(createTimelineEventType(value)).toBe(value);
  });

  it('rejects an unknown event type', () => {
    expect(() => createTimelineEventType('DELETED')).toThrow(CaseManagementError);
  });
});
