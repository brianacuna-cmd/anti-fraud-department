import type { CaseStatus } from '../model/value-objects/CaseStatus.js';
import type { SlaStatus } from '../model/value-objects/SlaStatus.js';
import type { EnforcementActionStatus } from '../model/value-objects/EnforcementActionStatus.js';
import type { ApprovalRequestStatus } from '../model/value-objects/ApprovalRequestStatus.js';
import type { CustomerOutgoingEventStatus } from '../model/value-objects/CustomerOutgoingEventStatus.js';

/**
 * Lookup table shape shared by every entity's transition table (mirrors
 * identity-access's `TransitionTable<S>`). `StatusTransitionPolicy` consumes
 * this — never an if/switch cascade.
 */
export type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;

/**
 * Case status edges (spec: "Case aggregate status lifecycle"). Forward path
 * OPEN -> IN_REVIEW -> RESOLVED -> ARCHIVED, plus T6 reopen edges
 * RESOLVED|ARCHIVED -> OPEN|IN_REVIEW encoded directly in the table (no
 * actor-gating needed for Case, unlike identity-access's reactivation edge).
 */
export const caseStatusTransitions: TransitionTable<CaseStatus> = {
  // OPEN must pass through IN_REVIEW before it can be RESOLVED (review gate,
  // PR: casemgmt-review-gate). `StartReview` (OPEN->IN_REVIEW) is the door.
  OPEN: ['IN_REVIEW'],
  IN_REVIEW: ['RESOLVED'],
  RESOLVED: ['ARCHIVED', 'OPEN', 'IN_REVIEW'],
  ARCHIVED: ['OPEN', 'IN_REVIEW'],
};

/**
 * CaseSlaTracking status edges (spec: "CaseSlaTracking status lifecycle").
 * Forward-only sweep path ON_TRACK -> WARNING -> BREACHED — no reverse edge;
 * `reset()` (T6) bypasses this table entirely and rehydrates a fresh
 * ON_TRACK row instead of "transitioning" backward.
 */
export const slaStatusTransitions: TransitionTable<SlaStatus> = {
  ON_TRACK: ['WARNING'],
  WARNING: ['BREACHED'],
  BREACHED: [],
};

/**
 * EnforcementAction status edges (spec: approval gate + execute).
 * REVIEW may execute from PENDING; non-REVIEW must pass through APPROVED first.
 * Those rules are enforced by `EnforcementAction.execute`, not this table alone.
 */
export const enforcementActionStatusTransitions: TransitionTable<EnforcementActionStatus> = {
  PENDING: ['APPROVED', 'REJECTED', 'EXECUTED'],
  APPROVED: ['EXECUTED'],
  EXECUTED: ['REVERTED'],
  REJECTED: [],
  REVERTED: [],
};

export const approvalRequestStatusTransitions: TransitionTable<ApprovalRequestStatus> = {
  PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: [],
  REJECTED: [],
};

export const customerOutgoingEventStatusTransitions: TransitionTable<CustomerOutgoingEventStatus> = {
  PENDING: ['SENT', 'FAILED'],
  SENT: [],
  FAILED: [],
};
