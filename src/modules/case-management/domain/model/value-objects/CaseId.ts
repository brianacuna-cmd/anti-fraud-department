import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export type CaseId = Brand<string, 'CaseId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createCaseId(value: string): CaseId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('CaseId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'CaseId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateCaseId(): CaseId {
  return brand<string, 'CaseId'>(generateObjectIdHex());
}
