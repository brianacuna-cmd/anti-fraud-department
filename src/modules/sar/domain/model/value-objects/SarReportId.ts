import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/SarError.js';

export type SarReportId = Brand<string, 'SarReportId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createSarReportId(value: string): SarReportId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('SarReportId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'SarReportId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateSarReportId(): SarReportId {
  return brand<string, 'SarReportId'>(generateObjectIdHex());
}
