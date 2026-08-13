import { randomBytes } from 'node:crypto';
import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export type CaseRoutingRuleId = Brand<string, 'CaseRoutingRuleId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createCaseRoutingRuleId(value: string): CaseRoutingRuleId {
  if (value.trim().length === 0) {
    throw invariantViolation('CaseRoutingRuleId must be a non-empty string', { value });
  }
  return brand<string, 'CaseRoutingRuleId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateCaseRoutingRuleId(): CaseRoutingRuleId {
  return brand<string, 'CaseRoutingRuleId'>(randomBytes(12).toString('hex'));
}
