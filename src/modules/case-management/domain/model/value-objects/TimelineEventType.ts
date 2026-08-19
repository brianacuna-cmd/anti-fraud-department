import { invariantViolation } from '../../errors/CaseManagementError.js';

/**
 * CaseTimeline's closed EventType vocabulary.
 *
 * The set is grouped by the subsystem that emits each event. It stays closed
 * on purpose: the timeline is the immutable audit narrative of a case, and an
 * open string field would let any caller invent a verb that no reader knows
 * how to render. Adding a member is a deliberate act — the UI's
 * `movementLabel` mapping and any consumer of `case_timeline` must learn it
 * at the same time.
 */
export type TimelineEventType =
  // --- Case lifecycle (CASE-001, 008, 009) ---
  | 'CASE_CREATED'
  | 'CASE_REOPENED'
  | 'STATE_CHANGED'
  // --- Intake / dedup (CASE-011) ---
  | 'SNAPSHOT_REFRESHED'
  // --- Triage (CASE-002, 006, 007) ---
  | 'ASSIGNED'
  | 'ROUTED'
  | 'PRIORITY_CHANGED'
  | 'TAGS_CHANGED'
  // --- SLA (CASE-003, 009) ---
  | 'SLA_INITIALIZED'
  | 'SLA_RESET'
  | 'SLA_BREACHED'
  // --- Investigation (INV-001, 002, 005, 006, 011) ---
  | 'NOTE_ADDED'
  | 'NOTE_DELETED'
  | 'EVIDENCE_UPLOADED'
  | 'EVIDENCE_DELETED'
  | 'DECISION_MADE'
  | 'CASE_RESOLVED'
  // --- Deep investigations (INV-008, 012) ---
  | 'INVESTIGATION_LINKED'
  | 'INVESTIGATION_UNLINKED'
  // --- Enforcement & approvals (ENF-001, 003, 004) ---
  | 'ENFORCEMENT_REQUESTED'
  | 'ENFORCEMENT_APPROVED'
  | 'ENFORCEMENT_REJECTED'
  | 'ENFORCEMENT_EXECUTED'
  | 'ENFORCEMENT_REVERTED'
  // --- Customer disputes (DISP-001, 002) ---
  | 'DISPUTE_OPENED'
  | 'DISPUTE_RESOLVED';

const VALID_EVENT_TYPES: ReadonlySet<string> = new Set<TimelineEventType>([
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
]);

export function createTimelineEventType(value: string): TimelineEventType {
  if (!VALID_EVENT_TYPES.has(value)) {
    throw invariantViolation(
      `TimelineEventType must be one of ${[...VALID_EVENT_TYPES].join(', ')}`,
      { value },
    );
  }
  return value as TimelineEventType;
}
