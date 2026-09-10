import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/PrivacyError.js';

export type PrivacyDataRequestId = Brand<string, 'PrivacyDataRequestId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createPrivacyDataRequestId(value: string): PrivacyDataRequestId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('PrivacyDataRequestId must be a 24-character hexadecimal ObjectId', {
      value,
    });
  }
  return brand<string, 'PrivacyDataRequestId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generatePrivacyDataRequestId(): PrivacyDataRequestId {
  return brand<string, 'PrivacyDataRequestId'>(generateObjectIdHex());
}
