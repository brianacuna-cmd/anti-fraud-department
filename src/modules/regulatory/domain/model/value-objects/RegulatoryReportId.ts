import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/RegulatoryError.js';

export type RegulatoryReportId = Brand<string, 'RegulatoryReportId'>;

export function createRegulatoryReportId(value: string): RegulatoryReportId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('RegulatoryReportId must be a 24-character hexadecimal ObjectId', {
      value,
    });
  }
  return brand<string, 'RegulatoryReportId'>(value);
}

export function generateRegulatoryReportId(): RegulatoryReportId {
  return brand<string, 'RegulatoryReportId'>(generateObjectIdHex());
}
