import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { invariantViolation } from '../../errors/ScreeningError.js';

/** Branded integer in [0, 100] — reject, do not clamp, out-of-range values. */
export type MatchScore = Brand<number, 'MatchScore'>;

export function createMatchScore(value: number): MatchScore {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw invariantViolation('MatchScore must be an integer between 0 and 100', { value });
  }
  return brand<number, 'MatchScore'>(value);
}
