import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/NotificationsError.js';

export type UserId = Brand<string, 'UserId'>;

/** Validates a raw id coming from `AuthContext` (module-owned copy — see design D3/D15). */
export function createUserId(value: string): UserId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('UserId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'UserId'>(value);
}
