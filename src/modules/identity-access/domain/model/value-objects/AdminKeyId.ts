import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/IdentityAccessError.js';

export type AdminKeyId = Brand<string, 'AdminKeyId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createAdminKeyId(value: string): AdminKeyId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('AdminKeyId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'AdminKeyId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateAdminKeyId(): AdminKeyId {
  return brand<string, 'AdminKeyId'>(generateObjectIdHex());
}
