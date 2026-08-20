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
  // Ingesta Finturu (CASE-011): una reincidencia sobre un expediente ya ACTIVO
  // refresca el snapshot en vez de abrir uno nuevo. Sin este hito la
  // reincidencia se absorbia en silencio y el analista no la veia.
  | 'SNAPSHOT_REFRESHED';

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
]);

export function createTimelineEventType(value: string): TimelineEventType {
  if (!VALID_EVENT_TYPES.has(value)) {
    throw invariantViolation(
      'TimelineEventType must be one of STATE_CHANGED, ASSIGNED, NOTE_ADDED, DECISION_MADE, CASE_CREATED, CASE_REOPENED, EVIDENCE_ADDED, PRIORITY_CHANGED, TAGS_UPDATED, EVIDENCE_DELETED, NOTE_DELETED, CASE_LINKED_TO_INVESTIGATION, SNAPSHOT_REFRESHED',
      { value },
    );
  }
  return value as TimelineEventType;
}
