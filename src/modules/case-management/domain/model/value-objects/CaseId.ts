import { randomBytes } from 'node:crypto';
import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export type CaseId = Brand<string, 'CaseId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createCaseId(value: string): CaseId {
  if (value.trim().length === 0) {
    throw invariantViolation('CaseId must be a non-empty string', { value });
  }
  return brand<string, 'CaseId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateCaseId(): CaseId {
  return brand<string, 'CaseId'>(randomBytes(12).toString('hex'));
}
