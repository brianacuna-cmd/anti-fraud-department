import {
  RiskAssessmentError,
  invariantViolation,
  forbiddenCrossTenant,
  scoringRuleNotFound,
} from '../../../../src/modules/risk-assessment/domain/errors/RiskAssessmentError.js';

describe('RiskAssessmentError factories', () => {
  it('invariantViolation produces INVARIANT_VIOLATION with the given message/metadata', () => {
    const error = invariantViolation('bad input', { value: 'x' });

    expect(error).toBeInstanceOf(RiskAssessmentError);
    expect(error.code).toBe('INVARIANT_VIOLATION');
    expect(error.message).toBe('bad input');
    expect(error.metadata).toEqual({ value: 'x' });
  });

  it('forbiddenCrossTenant produces FORBIDDEN_CROSS_TENANT', () => {
    const error = forbiddenCrossTenant();

    expect(error).toBeInstanceOf(RiskAssessmentError);
    expect(error.code).toBe('FORBIDDEN_CROSS_TENANT');
  });

  it('scoringRuleNotFound produces SCORING_RULE_NOT_FOUND for the organization', () => {
    const error = scoringRuleNotFound('org-1');

    expect(error).toBeInstanceOf(RiskAssessmentError);
    expect(error.code).toBe('SCORING_RULE_NOT_FOUND');
    expect(error.metadata).toEqual({ organizationId: 'org-1' });
  });
});
