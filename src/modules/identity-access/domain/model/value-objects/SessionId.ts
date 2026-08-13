import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/IdentityAccessError.js';

export type SessionId = Brand<string, 'SessionId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createSessionId(value: string): SessionId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('SessionId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'SessionId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateSessionId(): SessionId {
  return brand<string, 'SessionId'>(generateObjectIdHex());
}
