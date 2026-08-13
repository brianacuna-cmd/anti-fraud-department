import {
  createRiskScoringRuleId,
  generateRiskScoringRuleId,
} from '../../../../../src/modules/risk-assessment/domain/model/value-objects/RiskScoringRuleId.js';
import { RiskAssessmentError } from '../../../../../src/modules/risk-assessment/domain/errors/RiskAssessmentError.js';

const HEX = 'b'.repeat(24);

describe('createRiskScoringRuleId', () => {
  it('accepts a 24-character hexadecimal ObjectId', () => {
    expect(createRiskScoringRuleId(HEX)).toBe(HEX);
  });

  it('rejects a value that is not a 24-character hex ObjectId', () => {
    expect(() => createRiskScoringRuleId('')).toThrow(RiskAssessmentError);
    expect(() => createRiskScoringRuleId('not-an-objectid')).toThrow(RiskAssessmentError);
  });
});

describe('generateRiskScoringRuleId', () => {
  it('generates a unique 24-char hex id on every call', () => {
    const first = generateRiskScoringRuleId();
    const second = generateRiskScoringRuleId();

    expect(first).toMatch(/^[a-f0-9]{24}$/);
    expect(first).not.toBe(second);
  });
});
