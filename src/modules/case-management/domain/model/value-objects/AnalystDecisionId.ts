import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export type AnalystDecisionId = Brand<string, 'AnalystDecisionId'>;

export function createAnalystDecisionId(value: string): AnalystDecisionId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('AnalystDecisionId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'AnalystDecisionId'>(value);
}

export function generateAnalystDecisionId(): AnalystDecisionId {
  return brand<string, 'AnalystDecisionId'>(generateObjectIdHex());
}
