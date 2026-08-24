import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/ScreeningError.js';

export type AmlAlertId = Brand<string, 'AmlAlertId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createAmlAlertId(value: string): AmlAlertId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('AmlAlertId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'AmlAlertId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateAmlAlertId(): AmlAlertId {
  return brand<string, 'AmlAlertId'>(generateObjectIdHex());
}
