import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { invariantViolation } from '../../errors/NotificationsError.js';

export type UserId = Brand<string, 'UserId'>;

/** Validates a raw id coming from `AuthContext` (module-owned copy — see design D3/D15). */
export function createUserId(value: string): UserId {
  if (value.trim().length === 0) {
    throw invariantViolation('UserId must be a non-empty string', { value });
  }
  return brand<string, 'UserId'>(value);
}
