import type { Case } from '../model/aggregates/Case.js';
import { caseNotAssigned } from '../errors/CaseManagementError.js';

/**
 * A case without an assignee is frozen.
 *
 * While `assignedTo` is `null` the case does not leave `OPEN`: it is not
 * sent to review, notes and evidence are not added, no investigation is
 * opened, no decision is recorded, no measures are requested, and it is
 * not closed.
 *
 * WHY IN THE DOMAIN AND NOT IN EACH USE CASE
 *
 * Eight paths touch a case. A check repeated in eight places ends up in
 * seven — the same reason the four-eyes rule lives in the `ApprovalRequest`
 * aggregate and not in the three use cases that decide a request.
 *
 * WHY IT IS NOT A PERMISSIONS PROBLEM
 *
 * Whoever tries may have the perfect role. What is missing is that someone
 * is accountable for the case. That is why the error is `CASE_NOT_ASSIGNED`
 * (409) and not `FORBIDDEN_ROLE` (403): it is fixed by assigning the case,
 * not by switching users, and saying it wrong sends the person to ask for
 * permissions they already have.
 *
 * WHAT IT DOES NOT COVER
 *
 * `ReassignCase` is the way out of this state and therefore does not go
 * through here. Reassignment and reading the case stay open: looking at an
 * orphaned case is precisely what is needed to decide who to give it to.
 */
export function assertAssigned(kase: Case): void {
  if (kase.assignedTo === null) {
    throw caseNotAssigned(kase.id);
  }
}
