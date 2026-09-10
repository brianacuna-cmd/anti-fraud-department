import { ObjectId, type Collection, type Db } from 'mongodb';
import type { FraudDepartmentDailyTalliesReader } from '../../../../domain/ports/FraudDepartmentDailyTalliesReader.js';
import type { DailyTallies } from '../../../../domain/model/aggregates/computeDailyMetrics.js';
import type { CaseDocument } from './documents/CaseDocument.js';
import type { ResolutionDocument } from './documents/ResolutionDocument.js';
import type { AnalystDecisionDocument } from './documents/AnalystDecisionDocument.js';

const CASES = 'cases';
const RESOLUTIONS = 'resolutions';
const ANALYST_DECISIONS = 'analyst_decisions';
const CASE_SLA_TRACKING = 'case_sla_tracking';

interface ResolutionsFacetRow {
  readonly total: { count: number }[];
  readonly notBreached: { count: number }[];
}

interface DecisionsFacetRow {
  readonly total: { count: number }[];
  readonly falsePositives: { count: number }[];
  readonly modelPositive: { _id: string; count: number }[];
}

/**
 * PR2b (design #645, tasks #646 T2b): raw per-org daily tallies, mirroring
 * `MongoFraudMetricsReader`'s aggregation idiom but bucketing strictly by
 * the caller-supplied `[dayStartUtc, dayEndUtc)` `America/Bogota` range
 * (see `shared/time/bogotaDay.ts`) instead of `$dateToString` UTC.
 */
export class MongoFraudDepartmentDailyTalliesReader implements FraudDepartmentDailyTalliesReader {
  private readonly cases: Collection<CaseDocument>;
  private readonly resolutions: Collection<ResolutionDocument>;
  private readonly analystDecisions: Collection<AnalystDecisionDocument>;

  constructor(db: Db) {
    this.cases = db.collection<CaseDocument>(CASES);
    this.resolutions = db.collection<ResolutionDocument>(RESOLUTIONS);
    this.analystDecisions = db.collection<AnalystDecisionDocument>(ANALYST_DECISIONS);
  }

  async dailyTallies(input: {
    readonly organizationId: string;
    readonly dayStartUtc: Date;
    readonly dayEndUtc: Date;
    readonly riskThresholdHigh: number;
  }): Promise<DailyTallies> {
    const organizationId = new ObjectId(input.organizationId);
    const createdAtRange = { $gte: input.dayStartUtc, $lt: input.dayEndUtc };

    const [casesCreated, resolutionsTallies, decisionsTallies] = await Promise.all([
      this.cases.countDocuments({ organization_id: organizationId, created_at: createdAtRange, deleted_at: null }),
      this.resolutionsTallies(organizationId, createdAtRange),
      this.decisionsTallies(organizationId, createdAtRange, input.riskThresholdHigh),
    ]);

    return {
      casesCreated,
      resolutionsTotal: resolutionsTallies.resolutionsTotal,
      closedNotBreached: resolutionsTallies.closedNotBreached,
      decisionsTotal: decisionsTallies.decisionsTotal,
      falsePositive: decisionsTallies.falsePositive,
      modelPositiveFraud: decisionsTallies.modelPositiveFraud,
      modelPositiveFalsePositive: decisionsTallies.modelPositiveFalsePositive,
    };
  }

  /**
   * `casosCerrados` (resolutions created that day) + the SLA compliance
   * numerator: of those closed cases, how many `case_sla_tracking.status`
   * is NOT `BREACHED` (design calls the field "estado"; the document field
   * is `status`, values `ON_TRACK|WARNING|BREACHED`).
   */
  private async resolutionsTallies(
    organizationId: ObjectId,
    createdAtRange: { $gte: Date; $lt: Date },
  ): Promise<{ resolutionsTotal: number; closedNotBreached: number }> {
    const [row] = await this.resolutions
      .aggregate<ResolutionsFacetRow>([
        { $match: { organization_id: organizationId, created_at: createdAtRange } },
        {
          $facet: {
            total: [{ $count: 'count' }],
            notBreached: [
              {
                $lookup: {
                  from: CASE_SLA_TRACKING,
                  localField: 'case_id',
                  foreignField: 'case_id',
                  as: 'sla',
                },
              },
              { $unwind: '$sla' },
              { $match: { 'sla.status': { $ne: 'BREACHED' } } },
              { $count: 'count' },
            ],
          },
        },
      ])
      .toArray();

    return {
      resolutionsTotal: row?.total[0]?.count ?? 0,
      closedNotBreached: row?.notBreached[0]?.count ?? 0,
    };
  }

  /**
   * `analyst_decisions` that day: totals + false positives (fpr tallies),
   * plus TP/FP among decisions whose case is model-positive
   * (`case.risk_score >= riskThresholdHigh`) for precision.
   */
  private async decisionsTallies(
    organizationId: ObjectId,
    createdAtRange: { $gte: Date; $lt: Date },
    riskThresholdHigh: number,
  ): Promise<{
    decisionsTotal: number;
    falsePositive: number;
    modelPositiveFraud: number;
    modelPositiveFalsePositive: number;
  }> {
    const [row] = await this.analystDecisions
      .aggregate<DecisionsFacetRow>([
        { $match: { organization_id: organizationId, created_at: createdAtRange } },
        {
          $facet: {
            total: [{ $count: 'count' }],
            falsePositives: [{ $match: { decision: 'FALSE_POSITIVE' } }, { $count: 'count' }],
            modelPositive: [
              { $lookup: { from: CASES, localField: 'case_id', foreignField: '_id', as: 'kase' } },
              { $unwind: '$kase' },
              { $match: { 'kase.risk_score': { $gte: riskThresholdHigh } } },
              { $match: { decision: { $in: ['FRAUD_CONFIRMED', 'FALSE_POSITIVE'] } } },
              { $group: { _id: '$decision', count: { $sum: 1 } } },
            ],
          },
        },
      ])
      .toArray();

    const modelPositive = new Map((row?.modelPositive ?? []).map((entry) => [entry._id, entry.count]));

    return {
      decisionsTotal: row?.total[0]?.count ?? 0,
      falsePositive: row?.falsePositives[0]?.count ?? 0,
      modelPositiveFraud: modelPositive.get('FRAUD_CONFIRMED') ?? 0,
      modelPositiveFalsePositive: modelPositive.get('FALSE_POSITIVE') ?? 0,
    };
  }
}
