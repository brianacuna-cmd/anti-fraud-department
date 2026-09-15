import type { Case } from '../model/aggregates/Case.js';
import type { AnalystDecisionType } from '../model/value-objects/AnalystDecisionType.js';
import type { ResolutionOutcome } from '../model/value-objects/ResolutionOutcome.js';
import { isClosed } from './ClosedCaseGate.js';
import {
  caseNotReviewed,
  caseNotDecided,
  caseEnforcementPending,
  caseNotResolvedForReport,
  caseOutcomeContradictsDecision,
} from '../errors/CaseManagementError.js';

/**
 * Real, backend-enforced version of the guide `CaseProgress.tsx` already
 * shows in the UI (Asignado -> Revisión -> Dictamen ->
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
 * independent of the verdict, so they need no decision at all.
 */
const OUTCOME_REQUIRED_DECISION: Readonly<Partial<Record<ResolutionOutcome, AnalystDecisionType>>> = {
  FRAUD_CONFIRMED: 'FRAUD_CONFIRMED',
  FALSE_POSITIVE: 'FALSE_POSITIVE',
  INSUFFICIENT_EVIDENCE: 'INCONCLUSIVE',
};

const DECISION_OUTCOME: Readonly<Record<AnalystDecisionType, ResolutionOutcome>> = {
  FRAUD_CONFIRMED: 'FRAUD_CONFIRMED',
  FALSE_POSITIVE: 'FALSE_POSITIVE',
  INCONCLUSIVE: 'INSUFFICIENT_EVIDENCE',
};

export function isProceduralOutcome(outcome: ResolutionOutcome): boolean {
  return OUTCOME_REQUIRED_DECISION[outcome] === undefined;
}

export interface LatestDecision {
  readonly decision: AnalystDecisionType;
  readonly comment: string;
}

export interface ClosureVerdict {
  readonly outcome: ResolutionOutcome;
  readonly reason: string;
}

/**
 * The verdict is written ONCE, in the analyst decision. Resolving restates
 * it: when the supervisor omits the outcome or the reason, both come from
 * the latest decision. An explicit outcome is still honoured, but a
 * verdict-type outcome must agree with that decision, and only procedural
 * outcomes may close a case nobody has decided.
 */
export function resolveClosureVerdict(
  kase: Case,
  requested: { readonly outcome?: ResolutionOutcome; readonly reason?: string },
  latest: LatestDecision | null,
): ClosureVerdict {
  const outcome = requested.outcome ?? (latest === null ? null : DECISION_OUTCOME[latest.decision]);
  if (outcome === null) {
    throw caseNotDecided(kase.id);
  }
  const required = OUTCOME_REQUIRED_DECISION[outcome];
  if (required !== undefined && latest === null) {
    throw caseNotDecided(kase.id);
  }
  if (required !== undefined && required !== latest?.decision) {
    throw caseOutcomeContradictsDecision(kase.id, outcome, latest?.decision ?? null);
  }
  const reason = requested.reason?.trim() || latest?.comment.trim() || outcome;
  return { outcome, reason };
}

/** The report freezes the full case file — the case must be closed first. */
export function assertReadyForReport(kase: Case): void {
  if (!isClosed(kase)) {
    throw caseNotResolvedForReport(kase.id);
  }
}
