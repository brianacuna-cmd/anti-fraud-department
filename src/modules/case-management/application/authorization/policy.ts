import type { AuthContext } from '../../../../shared/kernel/AuthContext.js';
import {
  isObserver,
  ROLE_ADMIN,
  ROLE_ANALYST,
  ROLE_AUDITOR,
  ROLE_SUPERVISOR,
} from '../../../../shared/kernel/AccessTier.js';
import { forbiddenReadOnly, forbiddenRole } from '../../domain/errors/CaseManagementError.js';

/**
 * Case-management access policy, in a single file.
 *
 * Previously each use case declared its own list (`const CLOSE_ROLES =
 * ['SUPERVISOR', 'ADMIN']`) and the guard looked only at `roleId`. That had
 * two consequences, both wrong:
 *
 * 1. `ADMIN` could record decisions, close, sanction, and delete evidence —
 *    the same actor that grants and revokes permissions.
 * 2. The `ORGANIZATION` actor ALWAYS arrives with `roleId: null` (the
 *    session resolver only resolves a role for the `USER` actor), so even
 *    reads answered `role "null" is not authorized`.
 *
 * There are now two explicit guards — read and operation — and the lists
 * live here. See `shared/kernel/AccessTier.ts` for why they are split.
 */

/** Work a case: notes, priority, tags, analyst decision, bulk actions. */
export const CASE_WORK_ROLES: readonly string[] = [ROLE_ANALYST, ROLE_SUPERVISOR];

/**
 * Irreversible or authority acts: close, reopen, approve/reject and
 * execute sanctions, delete notes and evidence, and touch routing rules.
 * Supervisor only.
 */
export const SUPERVISION_ROLES: readonly string[] = [ROLE_SUPERVISOR];

/**
 * Distribute work: assign and reassign cases.
 *
 * `ADMIN` ONLY. Work distribution is a decision of whoever administers
 * people, not of whoever does the work: an analyst does not pick their
 * load and a supervisor does not keep the cases they prefer.
 *
 * Together with `AssignmentGate` this defines the department flow: cases
 * come in, automatic routing distributes them when a rule matches, and
 * whatever is left orphaned waits for ADMIN to assign it. Nobody works a
 * case they were not given.
 *
 * THE COST, stated: without an available ADMIN, unassigned cases stay
 * frozen. That is not a side effect; it is the direct consequence of
 * distribution being a single door.
 */
export const CASE_ASSIGN_ROLES: readonly string[] = [ROLE_ADMIN];

/**
 * ASSIGNMENT guard. Does not go through `isObserver` on purpose.
 *
 * `requireOperationalRole` rejects every observer before looking at the
 * list, which is correct for working a case; here the list DOES govern,
 * because `ADMIN` is an observer of cases and still distributes the work.
 * Putting this exception in its own guard — instead of opening a hole in
 * the other — is what keeps something that actually works a case from
 * slipping through tomorrow.
 */
export function requireAssignmentRole(auth: AuthContext): void {
  if (
    auth.actorType !== 'USER' ||
    auth.roleId === null ||
    !CASE_ASSIGN_ROLES.includes(auth.roleId)
  ) {
    throw forbiddenRole(auth.roleId, CASE_ASSIGN_ROLES);
  }
}

/** Oversight reads: sanction queue, rules, exports. */
export const OVERSIGHT_READ_ROLES: readonly string[] = [ROLE_SUPERVISOR, ROLE_ADMIN, ROLE_AUDITOR];

/**
 * WRITE guard. Requires a `USER` actor with an allowed operational role.
 *
 * The `ORGANIZATION` actor and observer roles (`ADMIN`, `AUDITOR`) are
 * rejected with a message that says their access is read-only, instead of
 * the cryptic `role "null"` the previous guard returned.
 */
export function requireOperationalRole(auth: AuthContext, allowed: readonly string[]): void {
  if (isObserver(auth)) {
    throw forbiddenReadOnly(auth, allowed);
  }
  if (auth.actorType !== 'USER' || auth.roleId === null || !allowed.includes(auth.roleId)) {
    throw forbiddenRole(auth.roleId, allowed);
  }
}

/**
 * READ guard. The `ORGANIZATION` actor always passes — it owns the tenant
 * and cannot see less than its own users —; the `USER` actor is subject to
 * the list.
 */
export function requireReadRole(auth: AuthContext, allowed: readonly string[]): void {
  if (auth.actorType === 'ORGANIZATION') {
    return;
  }
  if (auth.roleId === null || !allowed.includes(auth.roleId)) {
    throw forbiddenRole(auth.roleId, allowed);
  }
}
