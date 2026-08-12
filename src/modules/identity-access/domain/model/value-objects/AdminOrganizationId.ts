import { randomBytes } from 'node:crypto';
import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { invariantViolation } from '../../errors/IdentityAccessError.js';

export type AdminOrganizationId = Brand<string, 'AdminOrganizationId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createAdminOrganizationId(value: string): AdminOrganizationId {
  if (value.trim().length === 0) {
    throw invariantViolation('AdminOrganizationId must be a non-empty string', { value });
  }
  return brand<string, 'AdminOrganizationId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateAdminOrganizationId(): AdminOrganizationId {
  return brand<string, 'AdminOrganizationId'>(randomBytes(12).toString('hex'));
}
