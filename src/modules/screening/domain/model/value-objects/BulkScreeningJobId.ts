import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/ScreeningError.js';

export type BulkScreeningJobId = Brand<string, 'BulkScreeningJobId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createBulkScreeningJobId(value: string): BulkScreeningJobId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('BulkScreeningJobId must be a 24-character hexadecimal ObjectId', {
      value,
    });
  }
  return brand<string, 'BulkScreeningJobId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateBulkScreeningJobId(): BulkScreeningJobId {
  return brand<string, 'BulkScreeningJobId'>(generateObjectIdHex());
}
