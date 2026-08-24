import {
  calculateAmlAlertSeverity,
  maxSeverity,
  parseNivelRiesgo,
  severityFromConfianza,
} from '../../../../src/modules/screening/domain/services/AmlAlertSeverityCalculator.js';
import { DEFAULT_CONFIANZA_THRESHOLDS } from '../../../../src/modules/screening/domain/services/ConfianzaTiering.js';
import { createMatchScore } from '../../../../src/modules/screening/domain/model/value-objects/MatchScore.js';

describe('severityFromConfianza', () => {
  it.each([
    [0, null],
    [49, null],
    [50, 'MEDIUM'],
    [69, 'MEDIUM'],
    [70, 'HIGH'],
    [100, 'HIGH'],
  ] as const)('maps confianza=%d to %s at default thresholds', (score, expected) => {
    expect(severityFromConfianza(createMatchScore(score))).toBe(expected);
  });

  it('uses injected org thresholds instead of hardcoded 50/70', () => {
    const thresholds = { alertThreshold: 30, signalThreshold: 60 };

    expect(severityFromConfianza(createMatchScore(20), thresholds)).toBeNull();
    expect(severityFromConfianza(createMatchScore(45), thresholds)).toBe('MEDIUM');
    expect(severityFromConfianza(createMatchScore(80), thresholds)).toBe('HIGH');
  });
});

describe('parseNivelRiesgo', () => {
  it('returns a known severity', () => {
    expect(parseNivelRiesgo('CRITICAL')).toBe('CRITICAL');
  });

  it('returns null for unknown or missing values', () => {
    expect(parseNivelRiesgo(null)).toBeNull();
    expect(parseNivelRiesgo('SANCTIONED')).toBeNull();
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
      calculateAmlAlertSeverity(createMatchScore(40), DEFAULT_CONFIANZA_THRESHOLDS, 'HIGH'),
    ).toBeNull();
  });

  it('raises MEDIUM to HIGH when the matched entry is HIGH', () => {
    expect(
      calculateAmlAlertSeverity(createMatchScore(55), DEFAULT_CONFIANZA_THRESHOLDS, 'HIGH'),
    ).toBe('HIGH');
  });

  it('raises HIGH to CRITICAL when the matched entry is CRITICAL', () => {
    expect(
      calculateAmlAlertSeverity(createMatchScore(90), DEFAULT_CONFIANZA_THRESHOLDS, 'CRITICAL'),
    ).toBe('CRITICAL');
  });

  it('keeps the confianza band when nivelRiesgo is missing or unknown', () => {
    expect(
      calculateAmlAlertSeverity(createMatchScore(55), DEFAULT_CONFIANZA_THRESHOLDS, null),
    ).toBe('MEDIUM');
    expect(
      calculateAmlAlertSeverity(createMatchScore(80), DEFAULT_CONFIANZA_THRESHOLDS, 'PEP'),
    ).toBe('HIGH');
  });
});
