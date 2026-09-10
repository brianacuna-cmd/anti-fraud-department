/**
 * Raw per-org daily tallies produced by the Mongo aggregations (design:
 * MET-003), Bogota-bucketed. Pure input to `computeDailyMetrics` — no I/O.
 */
export interface DailyTallies {
  readonly casesCreated: number;
  readonly resolutionsTotal: number;
  readonly closedNotBreached: number;
  readonly decisionsTotal: number;
  readonly falsePositive: number;
  readonly modelPositiveFraud: number;
  readonly modelPositiveFalsePositive: number;
}

export interface ComputedDailyMetrics {
  readonly casosAbiertos: number;
  readonly casosCerrados: number;
  readonly slaCompliancePct: number | null;
  readonly falsePositiveRate: number | null;
  readonly precisionModelo: number | null;
}

/**
 * Pure compute: tallies → the 5 stored metric values, applying the
 * null-when-zero-denominator rules (design #645, LOCKED #642). Never sources
 * FP/precision from `resolutions.closure_type` — the caller must supply
 * `decisionsTotal`/`falsePositive`/`modelPositive*` from `analyst_decisions`.
 */
export function computeDailyMetrics(tallies: DailyTallies): ComputedDailyMetrics {
  const slaCompliancePct =
    tallies.resolutionsTotal === 0
      ? null
      : round((tallies.closedNotBreached / tallies.resolutionsTotal) * 100, 2);

  const falsePositiveRate =
    tallies.decisionsTotal === 0 ? null : round(tallies.falsePositive / tallies.decisionsTotal, 4);

  const modelPositiveTotal = tallies.modelPositiveFraud + tallies.modelPositiveFalsePositive;
  const precisionModelo =
    modelPositiveTotal === 0 ? null : round(tallies.modelPositiveFraud / modelPositiveTotal, 4);

  return {
    casosAbiertos: tallies.casesCreated,
    casosCerrados: tallies.resolutionsTotal,
    slaCompliancePct,
    falsePositiveRate,
    precisionModelo,
  };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
