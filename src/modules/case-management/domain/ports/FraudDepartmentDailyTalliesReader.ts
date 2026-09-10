import type { DailyTallies } from '../model/aggregates/computeDailyMetrics.js';

/**
 * Deferred T1.6 (design #645, tasks #646 PR2b): raw per-org daily tallies
 * that `computeDailyMetrics` consumes. `dayStartUtc`/`dayEndUtc` MUST be the
 * `[start, end)` UTC range of the target `America/Bogota` calendar day —
 * see `shared/time/bogotaDay.ts#bogotaDayUtcRange`. The reader does NOT read
 * `organization_fraud_config` itself: `riskThresholdHigh` is resolved by the
 * caller (PR3 use case) and passed in, keeping this a pure tallies query.
 */
export interface FraudDepartmentDailyTalliesReader {
  dailyTallies(input: {
    readonly organizationId: string;
    readonly dayStartUtc: Date;
    readonly dayEndUtc: Date;
    readonly riskThresholdHigh: number;
  }): Promise<DailyTallies>;
}
