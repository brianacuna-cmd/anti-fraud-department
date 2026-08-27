import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { AssigneeDirectory } from '../domain/ports/AssigneeDirectory.js';
import type {
  FraudMetricsReader,
  FraudMetricsSnapshot,
} from '../domain/ports/FraudMetricsReader.js';
import { createAssignedTo } from '../domain/model/value-objects/AssignedTo.js';
import { invariantViolation } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { OVERSIGHT_READ_ROLES, requireReadRole } from './authorization/policy.js';

/**
 * Default window and hard cap.
 *
 * The cap is not cosmetic: `flow` returns one point per day, so an unbounded
 * window turns a dashboard request into an arbitrarily large response and a
 * full scan of `cases`.
 */
export const DEFAULT_WINDOW_DAYS = 30;
export const MAX_WINDOW_DAYS = 365;

export interface GetFraudMetricsInput {
  readonly auth: AuthContext;
  readonly windowDays?: number;
}

export interface GetFraudMetricsDeps {
  readonly metrics: FraudMetricsReader;
  readonly clock: Clock;
  /** Only used to put names on the `workload` bars. */
  readonly assignees: AssigneeDirectory;
}

/**
 * GET /metrics/overview — the aggregated snapshot that feeds the governance dashboard.
 *
 * READ gate (`OVERSIGHT_READ_ROLES` + the ORGANIZATION actor): this is exactly
 * what the governance plane —ADMIN, AUDITOR, and the organization— is allowed
 * to do, now that it does not operate on cases. ANALYST is left out on
 * purpose: they work their inbox, not the department metric.
 */
export function createGetFraudMetricsUseCase(deps: GetFraudMetricsDeps) {
  return async function getFraudMetrics(
    input: GetFraudMetricsInput,
  ): Promise<FraudMetricsSnapshot> {
    requireReadRole(input.auth, OVERSIGHT_READ_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const windowDays = input.windowDays ?? DEFAULT_WINDOW_DAYS;

    if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > MAX_WINDOW_DAYS) {
      throw invariantViolation(`windowDays must be an integer between 1 and ${MAX_WINDOW_DAYS}`, {
        field: 'windowDays',
        value: windowDays,
      });
    }

    const snapshot = await deps.metrics.snapshot({
      organizationId,
      windowDays,
      now: deps.clock.now(),
    });

    return { ...snapshot, workload: await withNames(deps, organizationId, snapshot.workload) };
  };
}

/**
 * Puts names on the assignees.
 *
 * The read side only knows the id stored in `cases`, so the bar was labeled
 * with a hexadecimal ObjectId — useless for telling who has the cases on
 * their plate. An id that does not resolve (deleted user, retired role)
 * stays nameless and the UI decides how to label it: that is preferable to
 * inventing one.
 *
 * If the directory fails, the dashboard comes out without names rather than
 * not coming out at all: the workload is still readable from the numbers.
 */
async function withNames(
  deps: GetFraudMetricsDeps,
  organizationId: string,
  workload: FraudMetricsSnapshot['workload'],
): Promise<FraudMetricsSnapshot['workload']> {
  if (workload.length === 0) {
    return workload;
  }

  let names: ReadonlyMap<string, string>;
  try {
    names = await deps.assignees.displayNames(
      organizationId,
      workload.map((entry) =>
        createAssignedTo(entry.assigneeType === 'ROLE' ? 'ROLE' : 'USER', entry.assigneeId),
      ),
    );
  } catch {
    return workload;
  }

  return workload.map((entry) => ({ ...entry, assigneeName: names.get(entry.assigneeId) ?? null }));
}
