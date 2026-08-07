import { randomUUID } from 'node:crypto';
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

/** Mints a fresh id for a brand-new rotation family (design D37: crypto.randomUUID()). */
export function generateFamilyId(): FamilyId {
  return brand<string, 'FamilyId'>(randomUUID());
}
