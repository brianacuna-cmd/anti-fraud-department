import { createScoringRuleStatus } from '../../../../../src/modules/risk-assessment/domain/model/value-objects/ScoringRuleStatus.js';
import { RiskAssessmentError } from '../../../../../src/modules/risk-assessment/domain/errors/RiskAssessmentError.js';

describe('createScoringRuleStatus', () => {
  it.each(['ACTIVE', 'INACTIVE'] as const)('accepts %s', (status) => {
    expect(createScoringRuleStatus(status)).toBe(status);
  });

  it('rejects an unknown status', () => {
    expect(() => createScoringRuleStatus('DRAFT')).toThrow(RiskAssessmentError);
  });
});
