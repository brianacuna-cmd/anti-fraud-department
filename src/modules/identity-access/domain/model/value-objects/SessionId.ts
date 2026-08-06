import { randomUUID } from 'node:crypto';
import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { invariantViolation } from '../../errors/IdentityAccessError.js';

export type SessionId = Brand<string, 'SessionId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createSessionId(value: string): SessionId {
  if (value.trim().length === 0) {
    throw invariantViolation('SessionId must be a non-empty string', { value });
  }
  return brand<string, 'SessionId'>(value);
}

/** Mints a fresh id for a brand-new session (design D37: crypto.randomUUID()). */
export function generateSessionId(): SessionId {
  return brand<string, 'SessionId'>(randomUUID());
}
