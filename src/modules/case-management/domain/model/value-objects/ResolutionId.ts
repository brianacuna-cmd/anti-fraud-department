import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export type ResolutionId = Brand<string, 'ResolutionId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createResolutionId(value: string): ResolutionId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('ResolutionId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'ResolutionId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateResolutionId(): ResolutionId {
  return brand<string, 'ResolutionId'>(generateObjectIdHex());
}
