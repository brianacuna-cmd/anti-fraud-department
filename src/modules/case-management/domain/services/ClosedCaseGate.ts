import type { Case } from '../model/aggregates/Case.js';
import { caseClosed } from '../errors/CaseManagementError.js';

/** The two statuses in which the case is no longer worked. */
const CLOSED_STATUSES = new Set(['RESOLVED', 'ARCHIVED']);

export function isClosed(kase: Case): boolean {
  return CLOSED_STATUSES.has(kase.status);
}

/**
 * A closed case is not worked.
 *
 * No notes, evidence, investigations, analyst decisions, enforcement
 * actions, or priority/tag changes. If it still needs work, the path is
 * to reopen it — and that leaves its own milestone on the timeline.
 *
 * WHY IT MATTERS MORE HERE THAN IN ANOTHER SYSTEM
 *
 * The frozen report is generated on close. Allowing evidence to be added
 * afterwards produces the worst possible combination: a case whose real
 * contents no longer match the document delivered as its immutable
 * snapshot. Whoever receives that report will be reading something the
 * database already contradicts, with no way to know which of the two
 * counts.
 *
 * Reopening, by contrast, is explicit: it requires justification, resets
 * the SLA, is recorded, and the next report is generated on the new state.
 *
 * WHAT IT DOES NOT COVER
 *
 * `GenerateCaseReport` skips this on purpose: freezing the case is
 * precisely what is done AFTER closing it. And `ReassignCase` does too —
 * changing the assignee does not alter the case contents and is what is
 * needed so another person can reopen it.
 */
export function assertNotClosed(kase: Case): void {
  if (isClosed(kase)) {
    throw caseClosed(kase.id, kase.status);
  }
}
