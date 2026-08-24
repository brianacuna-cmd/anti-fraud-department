import type { MatchScore } from '../model/value-objects/MatchScore.js';
import type { AmlAlertSeverity } from '../model/value-objects/AmlAlertSeverity.js';
import type { ConfianzaThresholds } from './ConfianzaTiering.js';
import { DEFAULT_CONFIANZA_THRESHOLDS } from './ConfianzaTiering.js';

const KNOWN_NIVEL_RIESGO: ReadonlySet<string> = new Set<AmlAlertSeverity>([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);

const RANK: Readonly<Record<AmlAlertSeverity, number>> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

/**
 * Severity band from confianza vs the org's alert/signal thresholds.
 * Returns `null` below `alertThreshold` (caller must not open an expediente).
 * ALERT_ONLY → MEDIUM; ALERT_AND_SIGNAL → HIGH. Never hardcodes 50/70.
 */
export function severityFromConfianza(
  score: MatchScore,
  thresholds: ConfianzaThresholds = DEFAULT_CONFIANZA_THRESHOLDS,
): AmlAlertSeverity | null {
  if (score < thresholds.alertThreshold) {
    return null;
  }
  if (score >= thresholds.signalThreshold) {
    return 'HIGH';
  }
  return 'MEDIUM';
}

/** Parses a watchlist `nivel_riesgo` when it already is an AmlAlertSeverity. */
export function parseNivelRiesgo(value: string | null): AmlAlertSeverity | null {
  if (value === null) {
    return null;
  }
  if (!KNOWN_NIVEL_RIESGO.has(value)) {
    return null;
  }
  return value as AmlAlertSeverity;
}

export function maxSeverity(a: AmlAlertSeverity, b: AmlAlertSeverity | null): AmlAlertSeverity {
  if (b === null) {
    return a;
  }
  if (RANK[a] >= RANK[b]) {
    return a;
  }
  return b;
}

/**
 * Calculated expediente severity: the higher of the confianza band and the
 * matched entry's `nivelRiesgo` (when that value is a known severity).
 * `null` means similarity is below the configured alert threshold.
 */
export function calculateAmlAlertSeverity(
  score: MatchScore,
  thresholds: ConfianzaThresholds,
  nivelRiesgo: string | null,
): AmlAlertSeverity | null {
  const fromScore = severityFromConfianza(score, thresholds);
  if (fromScore === null) {
    return null;
  }
  return maxSeverity(fromScore, parseNivelRiesgo(nivelRiesgo));
}
