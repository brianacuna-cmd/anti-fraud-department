import type { Case } from '../model/aggregates/Case.js';
import type { AnalystDecisionType } from '../model/value-objects/AnalystDecisionType.js';
import type { ResolutionOutcome } from '../model/value-objects/ResolutionOutcome.js';
import { isClosed } from './ClosedCaseGate.js';
import {
  caseNotReviewed,
  caseNotInstructed,
  caseNotDecided,
  caseEnforcementPending,
  caseNotResolvedForReport,
  caseOutcomeContradictsDecision,
} from '../errors/CaseManagementError.js';

/**
 * Real, backend-enforced version of the guide `CaseProgress.tsx` already
 * shows in the UI (Asignado -> Revisión -> Instrucción -> Dictamen ->
 * [Medidas] -> Resolución -> Informe). Each `assert*` mirrors one boolean
 * that guide already computes from the same data, so the visual guide and
 * the real gate always tell the same story.
 *
 * Assignment (`AssignmentGate`) and closure (`ClosedCaseGate`) already gate
 * the first step and the general "case is not worked once closed" rule —
 * this file only adds the steps in between.
 */

export function isReviewed(kase: Case): boolean {
  return kase.status !== 'OPEN';
}

/** Notes and evidence require the case to have entered `IN_REVIEW` already. */
export function assertReviewStarted(kase: Case): void {
  if (!isReviewed(kase)) {
    throw caseNotReviewed(kase.id);
  }
}

/** A decision needs at least one note or one piece of evidence on file. */
export function assertInstructed(kase: Case, hasNoteOrEvidence: boolean): void {
  if (!hasNoteOrEvidence) {
    throw caseNotInstructed(kase.id);
  }
}

/** Resolving requires at least one recorded analyst decision. */
export function assertDecided(kase: Case, hasDecision: boolean): void {
  if (!hasDecision) {
    throw caseNotDecided(kase.id);
  }
}

/**
 * When any decision on the case is `FRAUD_CONFIRMED`, resolving also
 * requires an enforcement action to have been requested — a confirmed
 * fraud case cannot close with no sanction on record.
 */
export function assertEnforcementResolved(
  kase: Case,
  needsEnforcement: boolean,
  hasEnforcementAction: boolean,
): void {
  if (needsEnforcement && !hasEnforcementAction) {
    throw caseEnforcementPending(kase.id);
  }
}

/**
 * Outcomes that restate a verdict must agree with the LATEST decision (a
 * later decision supersedes an earlier one). The procedural outcomes
 * (DOCUMENTATION_NOT_PROVIDED, DUPLICATE) close the case for reasons that are
 * independent of the verdict, so any decision is compatible with them.
 */
const OUTCOME_REQUIRED_DECISION: Readonly<Partial<Record<ResolutionOutcome, AnalystDecisionType>>> = {
  FRAUD_CONFIRMED: 'FRAUD_CONFIRMED',
  FALSE_POSITIVE: 'FALSE_POSITIVE',
  INSUFFICIENT_EVIDENCE: 'INCONCLUSIVE',
};

export function assertOutcomeMatchesDecision(
  kase: Case,
  outcome: ResolutionOutcome,
  latestDecision: AnalystDecisionType | null,
): void {
  const required = OUTCOME_REQUIRED_DECISION[outcome];
  if (required !== undefined && required !== latestDecision) {
    throw caseOutcomeContradictsDecision(kase.id, outcome, latestDecision);
  }
}

/** The report freezes the full case file — the case must be closed first. */
export function assertReadyForReport(kase: Case): void {
  if (!isClosed(kase)) {
    throw caseNotResolvedForReport(kase.id);
  }
}
