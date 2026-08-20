import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/IdentityAccessError.js';

export type UserId = Brand<string, 'UserId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createUserId(value: string): UserId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('UserId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'UserId'>(value);
}

/**
 * Mints a fresh id for a brand-new user. Emits a 24-char hex string so the
 * Mongo mapper can store it as a native `ObjectId` (`new ObjectId(id)`);
 * the domain stays persistence-agnostic — it never imports the driver.
 */
export function generateUserId(): UserId {
  return brand<string, 'UserId'>(generateObjectIdHex());
}
