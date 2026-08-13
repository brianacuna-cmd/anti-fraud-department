import { randomBytes } from 'node:crypto';
import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export type CaseSlaTrackingId = Brand<string, 'CaseSlaTrackingId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createCaseSlaTrackingId(value: string): CaseSlaTrackingId {
  if (value.trim().length === 0) {
    throw invariantViolation('CaseSlaTrackingId must be a non-empty string', { value });
  }
  return brand<string, 'CaseSlaTrackingId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateCaseSlaTrackingId(): CaseSlaTrackingId {
  return brand<string, 'CaseSlaTrackingId'>(randomBytes(12).toString('hex'));
}
