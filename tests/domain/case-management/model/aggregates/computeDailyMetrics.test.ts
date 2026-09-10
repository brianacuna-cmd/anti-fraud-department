import {
  computeDailyMetrics,
  type DailyTallies,
} from '../../../../../src/modules/case-management/domain/model/aggregates/computeDailyMetrics.js';

const EMPTY: DailyTallies = {
  casesCreated: 0,
  resolutionsTotal: 0,
  closedNotBreached: 0,
  decisionsTotal: 0,
  falsePositive: 0,
  modelPositiveFraud: 0,
  modelPositiveFalsePositive: 0,
};

describe('computeDailyMetrics', () => {
  it('returns zero counts and null ratios on a fully inactive day', () => {
    const result = computeDailyMetrics(EMPTY);

    expect(result).toEqual({
      casosAbiertos: 0,
      casosCerrados: 0,
      slaCompliancePct: null,
      falsePositiveRate: null,
      precisionModelo: null,
    });
  });

  it('passes casesCreated/resolutionsTotal through as counts', () => {
    const result = computeDailyMetrics({ ...EMPTY, casesCreated: 7, resolutionsTotal: 4 });

    expect(result.casosAbiertos).toBe(7);
    expect(result.casosCerrados).toBe(4);
  });

  it('computes slaCompliancePct as closedNotBreached/resolutionsTotal*100 rounded to 2dp', () => {
    const result = computeDailyMetrics({
      ...EMPTY,
      resolutionsTotal: 4,
      closedNotBreached: 3,
    });

    expect(result.slaCompliancePct).toBe(75);
  });

  it('rounds slaCompliancePct to 2 decimal places', () => {
    const result = computeDailyMetrics({
      ...EMPTY,
      resolutionsTotal: 3,
      closedNotBreached: 1,
    });

    expect(result.slaCompliancePct).toBe(33.33);
  });

  it('returns null slaCompliancePct when resolutionsTotal is 0', () => {
    const result = computeDailyMetrics({ ...EMPTY, resolutionsTotal: 0 });

    expect(result.slaCompliancePct).toBeNull();
  });

  it('computes falsePositiveRate as falsePositive/decisionsTotal to 4dp', () => {
    const result = computeDailyMetrics({ ...EMPTY, decisionsTotal: 5, falsePositive: 2 });

    expect(result.falsePositiveRate).toBe(0.4);
  });

  it('returns null falsePositiveRate when decisionsTotal is 0', () => {
    const result = computeDailyMetrics({ ...EMPTY, decisionsTotal: 0, falsePositive: 0 });

    expect(result.falsePositiveRate).toBeNull();
  });

  it('computes precisionModelo as modelPositiveFraud/(modelPositiveFraud+modelPositiveFalsePositive) to 4dp', () => {
    const result = computeDailyMetrics({
      ...EMPTY,
      modelPositiveFraud: 2,
      modelPositiveFalsePositive: 1,
    });

    expect(result.precisionModelo).toBe(0.6667);
  });

  it('returns null precisionModelo when TP+FP is 0 (including no org config case)', () => {
    const result = computeDailyMetrics({
      ...EMPTY,
      modelPositiveFraud: 0,
      modelPositiveFalsePositive: 0,
    });

    expect(result.precisionModelo).toBeNull();
  });
});
