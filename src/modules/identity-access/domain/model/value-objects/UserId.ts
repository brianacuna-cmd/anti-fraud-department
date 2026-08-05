import { randomUUID } from 'node:crypto';
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

/** Mints a fresh id for a brand-new user (proposal: crypto.randomUUID()). */
export function generateUserId(): UserId {
  return brand<string, 'UserId'>(randomUUID());
}
