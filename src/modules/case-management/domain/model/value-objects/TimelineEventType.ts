import { invariantViolation } from '../../errors/CaseManagementError.js';

/**
 * CaseTimeline's closed EventType vocabulary (spec: "EventType/Action closed
 * vocabulary" — DEFAULT, pending team confirmation). If the team changes this
 * set, this VO and the `case_timeline_case_created_idx` index usage must be
 * revisited (design ADR carried from tasks Slice 3, item 1's BLOCKING FLAG).
 */
export type TimelineEventType =
  | 'STATE_CHANGED'
  | 'ASSIGNED'
  | 'NOTE_ADDED'
  | 'DECISION_MADE'
  | 'CASE_CREATED'
  | 'CASE_REOPENED'
  | 'EVIDENCE_ADDED'
  | 'PRIORITY_CHANGED'
  | 'TAGS_UPDATED'
  | 'EVIDENCE_DELETED'
  | 'NOTE_DELETED'
  | 'CASE_LINKED_TO_INVESTIGATION'
  // Finturu ingestion (CASE-011): a recurrence on an already ACTIVE case
  // refreshes the snapshot instead of opening a new one. Without this
  // milestone the recurrence was absorbed in silence and the analyst did
  // not see it.
  | 'SNAPSHOT_REFRESHED'
  // ENF-001: a precautionary measure requested on the case. Without this
  // milestone, the standalone request left no trace in the timeline and the
  // case told an incomplete story: the sanction appeared without a record of
  // who requested it or when.
  | 'ENFORCEMENT_REQUESTED';

const VALID_EVENT_TYPES: ReadonlySet<string> = new Set<TimelineEventType>([
  'STATE_CHANGED',
  'ASSIGNED',
  'NOTE_ADDED',
  'DECISION_MADE',
  'CASE_CREATED',
  'CASE_REOPENED',
  'EVIDENCE_ADDED',
  'PRIORITY_CHANGED',
  'TAGS_UPDATED',
  'EVIDENCE_DELETED',
  'NOTE_DELETED',
  'CASE_LINKED_TO_INVESTIGATION',
  'SNAPSHOT_REFRESHED',
  'ENFORCEMENT_REQUESTED',
]);

export function createTimelineEventType(value: string): TimelineEventType {
  if (!VALID_EVENT_TYPES.has(value)) {
    throw invariantViolation(
      'TimelineEventType must be one of STATE_CHANGED, ASSIGNED, NOTE_ADDED, DECISION_MADE, CASE_CREATED, CASE_REOPENED, EVIDENCE_ADDED, PRIORITY_CHANGED, TAGS_UPDATED, EVIDENCE_DELETED, NOTE_DELETED, CASE_LINKED_TO_INVESTIGATION, SNAPSHOT_REFRESHED, ENFORCEMENT_REQUESTED',
      { value },
    );
  }
  return value as TimelineEventType;
}
