import {
  tierConfianza,
  DEFAULT_CONFIANZA_THRESHOLDS,
} from '../../../../src/modules/screening/domain/services/ConfianzaTiering.js';
import { createMatchScore } from '../../../../src/modules/screening/domain/model/value-objects/MatchScore.js';

describe('tierConfianza', () => {
  it('exposes the default thresholds (50/70) per D-1', () => {
    expect(DEFAULT_CONFIANZA_THRESHOLDS).toEqual({ alertThreshold: 50, signalThreshold: 70 });
  });

  it.each([
    [0, 'DISCARD'],
    [49, 'DISCARD'],
    [50, 'ALERT_ONLY'],
    [69, 'ALERT_ONLY'],
    [70, 'ALERT_AND_SIGNAL'],
    [95, 'ALERT_AND_SIGNAL'],
    [100, 'ALERT_AND_SIGNAL'],
  ])('tiers confianza=%d as %s', (value, expected) => {
    expect(tierConfianza(createMatchScore(value))).toBe(expected);
  });

  it('respects an injected, org-configurable threshold set instead of hardcoded defaults', () => {
    const customThresholds = { alertThreshold: 30, signalThreshold: 60 };

    expect(tierConfianza(createMatchScore(40), customThresholds)).toBe('ALERT_ONLY');
    expect(tierConfianza(createMatchScore(65), customThresholds)).toBe('ALERT_AND_SIGNAL');
    expect(tierConfianza(createMatchScore(20), customThresholds)).toBe('DISCARD');
  });
});
