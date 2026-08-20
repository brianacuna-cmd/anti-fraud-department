import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/RiskAssessmentError.js';

export type RiskScoringRuleId = Brand<string, 'RiskScoringRuleId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createRiskScoringRuleId(value: string): RiskScoringRuleId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('RiskScoringRuleId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'RiskScoringRuleId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateRiskScoringRuleId(): RiskScoringRuleId {
  return brand<string, 'RiskScoringRuleId'>(generateObjectIdHex());
}
