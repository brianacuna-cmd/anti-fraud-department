import { randomBytes } from 'node:crypto';
import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { invariantViolation } from '../../errors/IdentityAccessError.js';

export type FamilyId = Brand<string, 'FamilyId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createFamilyId(value: string): FamilyId {
  if (value.trim().length === 0) {
    throw invariantViolation('FamilyId must be a non-empty string', { value });
  }
  return brand<string, 'FamilyId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateFamilyId(): FamilyId {
  return brand<string, 'FamilyId'>(randomBytes(12).toString('hex'));
}
