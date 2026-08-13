import { randomBytes } from 'node:crypto';
import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { invariantViolation } from '../../errors/IdentityAccessError.js';

export type OrganizationId = Brand<string, 'OrganizationId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createOrganizationId(value: string): OrganizationId {
  if (value.trim().length === 0) {
    throw invariantViolation('OrganizationId must be a non-empty string', { value });
  }
  return brand<string, 'OrganizationId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateOrganizationId(): OrganizationId {
  return brand<string, 'OrganizationId'>(randomBytes(12).toString('hex'));
}
