import { createTimelineEventType } from '../../../../../src/modules/case-management/domain/model/value-objects/TimelineEventType.js';
import { CaseManagementError } from '../../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

describe('createTimelineEventType', () => {
  it.each([
    'CASE_CREATED',
    'CASE_REOPENED',
    'STATE_CHANGED',
    'SNAPSHOT_REFRESHED',
    'ASSIGNED',
    'ROUTED',
    'PRIORITY_CHANGED',
    'TAGS_CHANGED',
    'SLA_INITIALIZED',
    'SLA_RESET',
    'SLA_BREACHED',
    'NOTE_ADDED',
    'NOTE_DELETED',
    'EVIDENCE_UPLOADED',
    'EVIDENCE_DELETED',
    'DECISION_MADE',
    'CASE_RESOLVED',
    'INVESTIGATION_LINKED',
    'INVESTIGATION_UNLINKED',
    'ENFORCEMENT_REQUESTED',
    'ENFORCEMENT_APPROVED',
    'ENFORCEMENT_REJECTED',
    'ENFORCEMENT_EXECUTED',
    'ENFORCEMENT_REVERTED',
    'DISPUTE_OPENED',
    'DISPUTE_RESOLVED',
  ])('accepts %s', (value) => {
    expect(createTimelineEventType(value)).toBe(value);
  });

  it('rejects an unknown event type', () => {
    expect(() => createTimelineEventType('DELETED')).toThrow(CaseManagementError);
  });

  it('keeps the vocabulary closed against lookalikes of accepted members', () => {
    expect(() => createTimelineEventType('case_created')).toThrow(CaseManagementError);
    expect(() => createTimelineEventType('SNAPSHOT_UPDATED')).toThrow(CaseManagementError);
  });
});
