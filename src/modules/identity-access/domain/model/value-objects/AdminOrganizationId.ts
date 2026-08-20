import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/IdentityAccessError.js';

export type AdminOrganizationId = Brand<string, 'AdminOrganizationId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createAdminOrganizationId(value: string): AdminOrganizationId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('AdminOrganizationId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'AdminOrganizationId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateAdminOrganizationId(): AdminOrganizationId {
  return brand<string, 'AdminOrganizationId'>(generateObjectIdHex());
}
