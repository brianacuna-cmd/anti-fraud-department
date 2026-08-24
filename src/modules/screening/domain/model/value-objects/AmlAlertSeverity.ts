import { invariantViolation } from '../../errors/ScreeningError.js';

export type AmlAlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

const VALID_SEVERITIES: ReadonlySet<string> = new Set<AmlAlertSeverity>([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);

export function createAmlAlertSeverity(value: string): AmlAlertSeverity {
  if (!VALID_SEVERITIES.has(value)) {
    throw invariantViolation('AmlAlertSeverity must be one of LOW, MEDIUM, HIGH, CRITICAL', {
      value,
    });
  }
  return value as AmlAlertSeverity;
}
