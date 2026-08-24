import {
  calculateAmlAlertSeverity,
  maxSeverity,
  parseRiskLevel,
  severityFromConfidence,
} from '../../../../src/modules/screening/domain/services/AmlAlertSeverityCalculator.js';
import { DEFAULT_CONFIDENCE_THRESHOLDS } from '../../../../src/modules/screening/domain/services/ConfidenceTiering.js';
import { createMatchScore } from '../../../../src/modules/screening/domain/model/value-objects/MatchScore.js';

describe('severityFromConfidence', () => {
  it.each([
    [0, null],
    [49, null],
    [50, 'MEDIUM'],
    [69, 'MEDIUM'],
    [70, 'HIGH'],
    [100, 'HIGH'],
  ] as const)('maps confidence=%d to %s at default thresholds', (score, expected) => {
    expect(severityFromConfidence(createMatchScore(score))).toBe(expected);
  });

  it('uses injected org thresholds instead of hardcoded 50/70', () => {
    const thresholds = { alertThreshold: 30, signalThreshold: 60 };

    expect(severityFromConfidence(createMatchScore(20), thresholds)).toBeNull();
    expect(severityFromConfidence(createMatchScore(45), thresholds)).toBe('MEDIUM');
    expect(severityFromConfidence(createMatchScore(80), thresholds)).toBe('HIGH');
  });
});

describe('parseRiskLevel', () => {
  it('returns a known severity', () => {
    expect(parseRiskLevel('CRITICAL')).toBe('CRITICAL');
  });

  it('returns null for unknown or missing values', () => {
    expect(parseRiskLevel(null)).toBeNull();
    expect(parseRiskLevel('SANCTIONED')).toBeNull();
  });
});

describe('maxSeverity', () => {
  it('keeps the higher of two bands', () => {
    expect(maxSeverity('MEDIUM', 'HIGH')).toBe('HIGH');
    expect(maxSeverity('CRITICAL', 'LOW')).toBe('CRITICAL');
    expect(maxSeverity('HIGH', null)).toBe('HIGH');
  });
});

describe('calculateAmlAlertSeverity', () => {
  it('returns null below the alert threshold', () => {
    expect(
      calculateAmlAlertSeverity(createMatchScore(40), DEFAULT_CONFIDENCE_THRESHOLDS, 'HIGH'),
    ).toBeNull();
  });

  it('raises MEDIUM to HIGH when the matched entry is HIGH', () => {
    expect(
      calculateAmlAlertSeverity(createMatchScore(55), DEFAULT_CONFIDENCE_THRESHOLDS, 'HIGH'),
    ).toBe('HIGH');
  });

  it('raises HIGH to CRITICAL when the matched entry is CRITICAL', () => {
    expect(
      calculateAmlAlertSeverity(createMatchScore(90), DEFAULT_CONFIDENCE_THRESHOLDS, 'CRITICAL'),
    ).toBe('CRITICAL');
  });

  it('keeps the confidence band when nivelRiesgo is missing or unknown', () => {
    expect(
      calculateAmlAlertSeverity(createMatchScore(55), DEFAULT_CONFIDENCE_THRESHOLDS, null),
    ).toBe('MEDIUM');
    expect(
      calculateAmlAlertSeverity(createMatchScore(80), DEFAULT_CONFIDENCE_THRESHOLDS, 'PEP'),
    ).toBe('HIGH');
  });
});
