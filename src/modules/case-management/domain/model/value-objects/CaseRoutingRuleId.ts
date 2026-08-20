import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export type CaseRoutingRuleId = Brand<string, 'CaseRoutingRuleId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createCaseRoutingRuleId(value: string): CaseRoutingRuleId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('CaseRoutingRuleId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'CaseRoutingRuleId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateCaseRoutingRuleId(): CaseRoutingRuleId {
  return brand<string, 'CaseRoutingRuleId'>(generateObjectIdHex());
}
