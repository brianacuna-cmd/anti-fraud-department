import type { Instant } from '../../../../shared/time/Instant.js';

/**
 * Daily series of openings and closures. One point per UTC calendar day,
 * including days with no movement: a series with gaps is drawn as a line
 * that jumps in time and lies about the slope.
 */
export interface DailyCaseFlowPoint {
  /** UTC day in `YYYY-MM-DD` format. */
  readonly date: string;
  readonly opened: number;
  readonly resolved: number;
}

/** Open cases per assignee, to see where work piles up. */
export interface AssigneeWorkload {
  readonly assigneeId: string;
  readonly assigneeType: string;
  /**
   * Readable name, resolved by `GetFraudMetrics` against the assignee
   * directory. Absent from what the reader returns —it only knows ids— and
   * `null` when the id no longer resolves (deleted user, retired role).
   */
  readonly assigneeName?: string | null;
  readonly open: number;
  readonly overdue: number;
}

export interface RiskBucket {
  readonly label: string;
  readonly from: number;
  readonly to: number;
  readonly count: number;
}

/**
 * Aggregated snapshot of the tenant for the governance dashboard.
 *
 * Everything is already aggregated counts: the dashboard is read-only and
 * whoever looks at it must not be able to deduce any concrete case from it.
 */
export interface FraudMetricsSnapshot {
  readonly generatedAt: Instant;
  readonly windowDays: number;
  readonly cases: {
    readonly total: number;
    readonly byStatus: Readonly<Record<string, number>>;
    readonly byPriority: Readonly<Record<string, number>>;
    readonly byRiskBucket: readonly RiskBucket[];
    /** Open or in review whose SLA deadline has already passed. */
    readonly overdue: number;
    /** Open or in review with no assignee. */
    readonly unassigned: number;
  };
  readonly flow: readonly DailyCaseFlowPoint[];
  readonly enforcement: {
    readonly byStatus: Readonly<Record<string, number>>;
    readonly byActionType: Readonly<Record<string, number>>;
    readonly pendingApproval: number;
  };
  readonly workload: readonly AssigneeWorkload[];
  readonly resolution: {
    readonly resolvedInWindow: number;
    /** `null` when no case was closed in the window. */
    readonly averageHoursToResolve: number | null;
  };
}

export interface FraudMetricsQuery {
  readonly organizationId: string;
  /** Length of the time window, in days, for `flow` and `resolution`. */
  readonly windowDays: number;
  readonly now: Instant;
}

/**
 * Read side of the dashboard. Lives as its own port, and not as another
 * method of `CaseRepository`, because it does not return domain aggregates
 * but a read model: it mixes `cases`, `enforcement_actions`, and
 * `resolutions` and cannot be rehydrated into anything.
 */
export interface FraudMetricsReader {
  snapshot(query: FraudMetricsQuery): Promise<FraudMetricsSnapshot>;
}
