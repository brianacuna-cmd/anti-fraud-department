import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export type CaseNoteId = Brand<string, 'CaseNoteId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createCaseNoteId(value: string): CaseNoteId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('CaseNoteId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'CaseNoteId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateCaseNoteId(): CaseNoteId {
  return brand<string, 'CaseNoteId'>(generateObjectIdHex());
}
