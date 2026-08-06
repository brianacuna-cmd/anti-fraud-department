import { randomUUID } from 'node:crypto';
import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { invariantViolation } from '../../errors/IdentityAccessError.js';

export type AdminKeyId = Brand<string, 'AdminKeyId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createAdminKeyId(value: string): AdminKeyId {
  if (value.trim().length === 0) {
    throw invariantViolation('AdminKeyId must be a non-empty string', { value });
  }
  return brand<string, 'AdminKeyId'>(value);
}

/** Mints a fresh id for a brand-new admin key (mirrors OrganizationId.ts: crypto.randomUUID()). */
export function generateAdminKeyId(): AdminKeyId {
  return brand<string, 'AdminKeyId'>(randomUUID());
}
