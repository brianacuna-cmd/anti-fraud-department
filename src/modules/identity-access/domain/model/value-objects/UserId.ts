import { randomBytes } from 'node:crypto';
import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { invariantViolation } from '../../errors/IdentityAccessError.js';

export type UserId = Brand<string, 'UserId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createUserId(value: string): UserId {
  if (value.trim().length === 0) {
    throw invariantViolation('UserId must be a non-empty string', { value });
  }
  return brand<string, 'UserId'>(value);
}

/**
 * Mints a fresh id for a brand-new user. Emits a 24-char hex string so the
 * Mongo mapper can store it as a native `ObjectId` (`new ObjectId(id)`);
 * the domain stays persistence-agnostic — it never imports the driver.
 */
export function generateUserId(): UserId {
  return brand<string, 'UserId'>(randomBytes(12).toString('hex'));
}
