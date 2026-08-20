import { createRiskScore } from '../../../../../src/modules/risk-assessment/domain/model/value-objects/RiskScore.js';
import { RiskAssessmentError } from '../../../../../src/modules/risk-assessment/domain/errors/RiskAssessmentError.js';

describe('createRiskScore', () => {
  it.each([0, 50, 100])('accepts %d', (value) => {
    expect(createRiskScore(value)).toBe(value);
  });

  it('rejects a negative value instead of clamping to 0', () => {
    expect(() => createRiskScore(-1)).toThrow(RiskAssessmentError);
    try {
      createRiskScore(-1);
    } catch (error) {
      expect(error).toBeInstanceOf(RiskAssessmentError);
      expect((error as RiskAssessmentError).code).toBe('INVARIANT_VIOLATION');
    }
  });

  it('rejects a value above 100 instead of clamping to 100', () => {
    expect(() => createRiskScore(101)).toThrow(RiskAssessmentError);
    try {
      createRiskScore(101);
    } catch (error) {
      expect(error).toBeInstanceOf(RiskAssessmentError);
      expect((error as RiskAssessmentError).code).toBe('INVARIANT_VIOLATION');
    }
  });

  it('rejects a non-integer value', () => {
    expect(() => createRiskScore(50.5)).toThrow(RiskAssessmentError);
  });
});
