import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { invariantViolation } from '../../errors/RiskAssessmentError.js';

/** Branded integer in [0, 100] — reject, do not clamp, out-of-range values. */
export type RiskScore = Brand<number, 'RiskScore'>;

export function createRiskScore(value: number): RiskScore {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw invariantViolation('RiskScore must be an integer between 0 and 100', { value });
  }
  return brand<number, 'RiskScore'>(value);
}
