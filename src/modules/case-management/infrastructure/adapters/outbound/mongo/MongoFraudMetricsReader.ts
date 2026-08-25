import { ObjectId, type Collection, type Db, type Document, type Filter } from 'mongodb';
import type {
  AssigneeWorkload,
  DailyCaseFlowPoint,
  FraudMetricsQuery,
  FraudMetricsReader,
  FraudMetricsSnapshot,
  RiskBucket,
} from '../../../../domain/ports/FraudMetricsReader.js';
import type { CaseDocument } from './documents/CaseDocument.js';
import type { EnforcementActionDocument } from './documents/EnforcementActionDocument.js';
import type { ResolutionDocument } from './documents/ResolutionDocument.js';
import { toDate } from '../../../../../../shared/time/Instant.js';

const CASES = 'cases';
const ENFORCEMENT_ACTIONS = 'enforcement_actions';
const RESOLUTIONS = 'resolutions';

/** Statuses in which a case is still on someone's desk. */
const ACTIVE_STATUSES = ['OPEN', 'IN_REVIEW'];

/**
 * Dashboard risk cuts. Fixed and named here —not configurable— so two
 * readings of the dashboard at different times are comparable.
 */
const RISK_BUCKETS: readonly { label: string; from: number; to: number }[] = [
  { label: 'Bajo', from: 0, to: 24 },
  { label: 'Medio', from: 25, to: 49 },
  { label: 'Alto', from: 50, to: 74 },
  { label: 'Crítico', from: 75, to: 100 },
];

/** How many assignees `workload` returns: one bar per person, not a census. */
const WORKLOAD_LIMIT = 8;

interface CountRow {
  readonly _id: string | null;
  readonly count: number;
}

/**
 * Read side of the governance dashboard.
 *
 * Everything is resolved with `aggregate` on the server and NEVER by bringing
 * the cases into the process: the dashboard is opened by whoever supervises
 * the whole department, so the alternative —list and count in Node— grows
 * with tenant size exactly for whoever has the most cases.
 */
export class MongoFraudMetricsReader implements FraudMetricsReader {
  private readonly cases: Collection<CaseDocument>;
  private readonly enforcementActions: Collection<EnforcementActionDocument>;
  private readonly resolutions: Collection<ResolutionDocument>;

  constructor(db: Db) {
    this.cases = db.collection<CaseDocument>(CASES);
    this.enforcementActions = db.collection<EnforcementActionDocument>(ENFORCEMENT_ACTIONS);
    this.resolutions = db.collection<ResolutionDocument>(RESOLUTIONS);
  }

  async snapshot(query: FraudMetricsQuery): Promise<FraudMetricsSnapshot> {
    const organizationId = new ObjectId(query.organizationId);
    const now = toDate(query.now);
    const windowStart = startOfUtcDay(addDays(now, -(query.windowDays - 1)));
    // `deleted_at: null` on EVERY query: a withdrawn case must not keep
    // adding to any dashboard bar.
    const tenant = { organization_id: organizationId, deleted_at: null };

    const [byStatus, byPriority, byRiskBucket, overdue, unassigned, opened, enforcementByStatus, enforcementByType, workload, closures] =
      await Promise.all([
        this.countBy(this.cases, tenant, '$status'),
        this.countBy(this.cases, tenant, '$priority'),
        this.riskBuckets(tenant),
        this.cases.countDocuments({
          ...tenant,
          status: { $in: ACTIVE_STATUSES },
          due_date: { $ne: null, $lt: now },
        }),
        this.cases.countDocuments({ ...tenant, status: { $in: ACTIVE_STATUSES }, assigned_to: null }),
        this.openedPerDay({ ...tenant, created_at: { $gte: windowStart } }),
        this.countBy(this.enforcementActions, { organization_id: organizationId }, '$status'),
        this.countBy(this.enforcementActions, { organization_id: organizationId }, '$action_type'),
        this.workload(tenant, now),
        this.closures(organizationId, windowStart),
      ]);

    const totals = Object.values(byStatus).reduce((sum, value) => sum + value, 0);

    return {
      generatedAt: query.now,
      windowDays: query.windowDays,
      cases: {
        total: totals,
        byStatus,
        byPriority,
        byRiskBucket,
        overdue,
        unassigned,
      },
      flow: buildFlowSeries(windowStart, query.windowDays, opened, closures.daily),
      enforcement: {
        byStatus: enforcementByStatus,
        byActionType: enforcementByType,
        pendingApproval: enforcementByStatus.PENDING ?? 0,
      },
      workload,
      resolution: closures.resolution,
    };
  }

  /**
   * `$group` by a field, generic over the collection: `cases` and
   * `enforcement_actions` count the same and only change origin and filter.
   */
  private async countBy<T extends Document>(
    collection: Collection<T>,
    match: Filter<T>,
    field: string,
  ): Promise<Record<string, number>> {
    const rows = await collection
      .aggregate<CountRow>([{ $match: match }, { $group: { _id: field, count: { $sum: 1 } } }])
      .toArray();
    return Object.fromEntries(
      rows.filter((row) => row._id !== null).map((row) => [row._id as string, row.count]),
    );
  }

  private async riskBuckets(match: Record<string, unknown>): Promise<readonly RiskBucket[]> {
    const rows = await this.cases
      .aggregate<{ _id: number; count: number }>([
        { $match: match },
        {
          $bucket: {
            groupBy: '$risk_score',
            boundaries: [...RISK_BUCKETS.map((bucket) => bucket.from), 101],
            // A `risk_score` outside 0..100 would be corrupt data; let it
            // fall into a bucket of its own and not contaminate the "Crítico" band.
            default: -1,
            output: { count: { $sum: 1 } },
          },
        },
      ])
      .toArray();

    const counts = new Map(rows.map((row) => [row._id, row.count]));
    return RISK_BUCKETS.map((bucket) => ({ ...bucket, count: counts.get(bucket.from) ?? 0 }));
  }

  /** Openings per UTC calendar day. Closures come from `closures`, with its join. */
  private async openedPerDay(match: Filter<CaseDocument>): Promise<Map<string, number>> {
    const rows = await this.cases
      .aggregate<CountRow>([
        { $match: match },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at', timezone: 'UTC' } },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray();
    return new Map(
      rows.filter((row) => row._id !== null).map((row) => [row._id as string, row.count]),
    );
  }

  private async workload(
    match: Record<string, unknown>,
    now: Date,
  ): Promise<readonly AssigneeWorkload[]> {
    const rows = await this.cases
      .aggregate<{
        _id: { assignee: string; type: string | null };
        open: number;
        overdue: number;
      }>([
        { $match: { ...match, status: { $in: ACTIVE_STATUSES }, assigned_to: { $ne: null } } },
        {
          $group: {
            _id: { assignee: '$assigned_to', type: '$assigned_to_type' },
            open: { $sum: 1 },
            overdue: {
              $sum: {
                $cond: [
                  { $and: [{ $ne: ['$due_date', null] }, { $lt: ['$due_date', now] }] },
                  1,
                  0,
                ],
              },
            },
          },
        },
        { $sort: { open: -1 } },
        { $limit: WORKLOAD_LIMIT },
      ])
      .toArray();

    return rows.map((row) => ({
      assigneeId: row._id.assignee,
      assigneeType: row._id.type ?? 'USER',
      open: row.open,
      overdue: row.overdue,
    }));
  }

  /**
   * Closures in the window: the daily series and how long they took on average.
   *
   * Both come from the SAME aggregation (`$facet`) because they share a
   * filter, and that filter is why counting `resolutions` is not enough:
   *
   * - Time is measured against `cases.created_at`, and `resolutions` stores
   *   when it was closed but not when it was opened — hence the `$lookup`.
   * - A withdrawn case (`deleted_at`) does not count on any other dashboard
   *   bar. Counting `resolutions` alone, its closure DID appear on the
   *   line: the dashboard contradicted itself, with a day that recorded
   *   more closures than openings without anything unusual having happened.
   */
  private async closures(
    organizationId: ObjectId,
    windowStart: Date,
  ): Promise<{
    daily: Map<string, number>;
    resolution: { resolvedInWindow: number; averageHoursToResolve: number | null };
  }> {
    const [row] = await this.resolutions
      .aggregate<{
        daily: CountRow[];
        totals: { resolvedInWindow: number; averageMs: number | null }[];
      }>([
        { $match: { organization_id: organizationId, created_at: { $gte: windowStart } } },
        { $lookup: { from: CASES, localField: 'case_id', foreignField: '_id', as: 'kase' } },
        { $unwind: '$kase' },
        { $match: { 'kase.deleted_at': null } },
        {
          $facet: {
            daily: [
              {
                $group: {
                  _id: {
                    $dateToString: { format: '%Y-%m-%d', date: '$created_at', timezone: 'UTC' },
                  },
                  count: { $sum: 1 },
                },
              },
            ],
            totals: [
              {
                $group: {
                  _id: null,
                  resolvedInWindow: { $sum: 1 },
                  averageMs: { $avg: { $subtract: ['$created_at', '$kase.created_at'] } },
                },
              },
            ],
          },
        },
      ])
      .toArray();

    const daily = new Map(
      (row?.daily ?? [])
        .filter((entry) => entry._id !== null)
        .map((entry) => [entry._id as string, entry.count]),
    );
    const totals = row?.totals[0];

    return {
      daily,
      resolution: {
        resolvedInWindow: totals?.resolvedInWindow ?? 0,
        averageHoursToResolve:
          totals?.averageMs == null ? null : Math.round((totals.averageMs / 3_600_000) * 10) / 10,
      },
    };
  }
}

/**
 * Fills days with no activity with zeros. Mongo only returns days that exist;
 * a series with gaps draws a line that skips dates.
 */
function buildFlowSeries(
  windowStart: Date,
  windowDays: number,
  opened: Map<string, number>,
  resolved: Map<string, number>,
): readonly DailyCaseFlowPoint[] {
  const points: DailyCaseFlowPoint[] = [];
  for (let offset = 0; offset < windowDays; offset += 1) {
    const date = addDays(windowStart, offset).toISOString().slice(0, 10);
    points.push({ date, opened: opened.get(date) ?? 0, resolved: resolved.get(date) ?? 0 });
  }
  return points;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
