import type { MatchScore } from '../model/value-objects/MatchScore.js';

export type ConfidenceTier = 'DISCARD' | 'ALERT_ONLY' | 'ALERT_AND_SIGNAL';

export interface ConfidenceThresholds {
  readonly alertThreshold: number;
  readonly signalThreshold: number;
}

/**
 * D-1: confidence >= 70 propagates riskSignals; >= 50 (and < 70) writes an
 * aml_alerts alert only; < 50 discards. Boundaries inclusive at 50 and 70.
 * Org-configurable via an injected threshold set — never hardcode literals
 * at call sites.
 */
export const DEFAULT_CONFIDENCE_THRESHOLDS: ConfidenceThresholds = {
  alertThreshold: 50,
  signalThreshold: 70,
};

export function tierConfidence(
  score: MatchScore,
  thresholds: ConfidenceThresholds = DEFAULT_CONFIDENCE_THRESHOLDS,
): ConfidenceTier {
  if (score >= thresholds.signalThreshold) {
    return 'ALERT_AND_SIGNAL';
  }
  if (score >= thresholds.alertThreshold) {
    return 'ALERT_ONLY';
  }
  return 'DISCARD';
}
