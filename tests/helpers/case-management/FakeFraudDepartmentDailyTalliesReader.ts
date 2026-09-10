import type { DailyTallies } from '../../../src/modules/case-management/domain/model/aggregates/computeDailyMetrics.js';
import type { FraudDepartmentDailyTalliesReader } from '../../../src/modules/case-management/domain/ports/FraudDepartmentDailyTalliesReader.js';

const EMPTY: DailyTallies = {
  casesCreated: 0,
  resolutionsTotal: 0,
  closedNotBreached: 0,
  decisionsTotal: 0,
  falsePositive: 0,
  modelPositiveFraud: 0,
  modelPositiveFalsePositive: 0,
};

export interface DailyTalliesCall {
  readonly organizationId: string;
  readonly dayStartUtc: Date;
  readonly dayEndUtc: Date;
  readonly riskThresholdHigh: number;
}

/**
 * Test double for `FraudDepartmentDailyTalliesReader` — per-org fixtures
 * (defaulting to all-zero tallies) plus an optional per-org failure and a
 * call log for orchestration assertions (pagination order, threshold
 * resolution).
 */
export class FakeFraudDepartmentDailyTalliesReader implements FraudDepartmentDailyTalliesReader {
  private readonly byOrganization = new Map<string, DailyTallies>();
  private readonly failing = new Set<string>();
  readonly calls: DailyTalliesCall[] = [];

  seed(organizationId: string, tallies: Partial<DailyTallies>): void {
    this.byOrganization.set(organizationId, { ...EMPTY, ...tallies });
  }

  failFor(organizationId: string): void {
    this.failing.add(organizationId);
  }

  async dailyTallies(input: {
    readonly organizationId: string;
    readonly dayStartUtc: Date;
    readonly dayEndUtc: Date;
    readonly riskThresholdHigh: number;
  }): Promise<DailyTallies> {
    this.calls.push({ ...input });
    if (this.failing.has(input.organizationId)) {
      throw new Error(`fake tallies reader failure for org ${input.organizationId}`);
    }
    return this.byOrganization.get(input.organizationId) ?? EMPTY;
  }
}
