import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export type CaseSlaTrackingId = Brand<string, 'CaseSlaTrackingId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createCaseSlaTrackingId(value: string): CaseSlaTrackingId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('CaseSlaTrackingId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'CaseSlaTrackingId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateCaseSlaTrackingId(): CaseSlaTrackingId {
  return brand<string, 'CaseSlaTrackingId'>(generateObjectIdHex());
}
