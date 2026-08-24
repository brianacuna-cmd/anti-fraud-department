import {
  tierConfidence,
  DEFAULT_CONFIDENCE_THRESHOLDS,
} from '../../../../src/modules/screening/domain/services/ConfidenceTiering.js';
import { createMatchScore } from '../../../../src/modules/screening/domain/model/value-objects/MatchScore.js';

describe('tierConfidence', () => {
  it('exposes the default thresholds (50/70) per D-1', () => {
    expect(DEFAULT_CONFIDENCE_THRESHOLDS).toEqual({ alertThreshold: 50, signalThreshold: 70 });
  });

  it.each([
    [0, 'DISCARD'],
    [49, 'DISCARD'],
    [50, 'ALERT_ONLY'],
    [69, 'ALERT_ONLY'],
    [70, 'ALERT_AND_SIGNAL'],
    [95, 'ALERT_AND_SIGNAL'],
    [100, 'ALERT_AND_SIGNAL'],
  ])('tiers confidence=%d as %s', (value, expected) => {
    expect(tierConfidence(createMatchScore(value))).toBe(expected);
  });

  it('respects an injected, org-configurable threshold set instead of hardcoded defaults', () => {
    const customThresholds = { alertThreshold: 30, signalThreshold: 60 };

    expect(tierConfidence(createMatchScore(40), customThresholds)).toBe('ALERT_ONLY');
    expect(tierConfidence(createMatchScore(65), customThresholds)).toBe('ALERT_AND_SIGNAL');
    expect(tierConfidence(createMatchScore(20), customThresholds)).toBe('DISCARD');
  });
});
