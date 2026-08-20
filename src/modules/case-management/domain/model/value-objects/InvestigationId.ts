import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export type InvestigationId = Brand<string, 'InvestigationId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createInvestigationId(value: string): InvestigationId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('InvestigationId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'InvestigationId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateInvestigationId(): InvestigationId {
  return brand<string, 'InvestigationId'>(generateObjectIdHex());
}
