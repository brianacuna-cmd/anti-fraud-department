import type { MatchScore } from '../model/value-objects/MatchScore.js';

export type ConfianzaTier = 'DISCARD' | 'ALERT_ONLY' | 'ALERT_AND_SIGNAL';

export interface ConfianzaThresholds {
  readonly alertThreshold: number;
  readonly signalThreshold: number;
}

/**
 * D-1: confianza >= 70 propagates riskSignals; >= 50 (and < 70) writes an
 * aml_alerts alert only; < 50 discards. Boundaries inclusive at 50 and 70.
 * Org-configurable via an injected threshold set — never hardcode literals
 * at call sites.
 */
export const DEFAULT_CONFIANZA_THRESHOLDS: ConfianzaThresholds = {
  alertThreshold: 50,
  signalThreshold: 70,
};

export function tierConfianza(
  score: MatchScore,
  thresholds: ConfianzaThresholds = DEFAULT_CONFIANZA_THRESHOLDS,
): ConfianzaTier {
  if (score >= thresholds.signalThreshold) {
    return 'ALERT_AND_SIGNAL';
  }
  if (score >= thresholds.alertThreshold) {
    return 'ALERT_ONLY';
  }
  return 'DISCARD';
}
