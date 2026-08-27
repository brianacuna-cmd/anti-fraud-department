import { invariantViolation } from '../../errors/ScreeningError.js';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

const VALID_RISK_LEVELS: ReadonlySet<string> = new Set<RiskLevel>(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

/** Non-throwing guard for untrusted input. */
export function isRiskLevel(value: unknown): value is RiskLevel {
  return typeof value === 'string' && VALID_RISK_LEVELS.has(value);
}

export function createRiskLevel(value: string): RiskLevel {
  if (!VALID_RISK_LEVELS.has(value)) {
    throw invariantViolation('RiskLevel must be one of LOW, MEDIUM, HIGH, CRITICAL', { value });
  }
  return value as RiskLevel;
}
