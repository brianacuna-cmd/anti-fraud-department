import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export type CaseReportId = Brand<string, 'CaseReportId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createCaseReportId(value: string): CaseReportId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('CaseReportId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'CaseReportId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateCaseReportId(): CaseReportId {
  return brand<string, 'CaseReportId'>(generateObjectIdHex());
}
