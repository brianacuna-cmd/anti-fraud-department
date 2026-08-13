import { riskAssessmentErrorStatus } from '../../../src/modules/risk-assessment/infrastructure/adapters/inbound/http/errorStatus.js';

describe('riskAssessmentErrorStatus', () => {
  it('maps every closed risk-assessment error code to its HTTP status', () => {
    expect(riskAssessmentErrorStatus).toEqual({
      INVARIANT_VIOLATION: 400,
      FORBIDDEN_CROSS_TENANT: 403,
      SCORING_RULE_NOT_FOUND: 404,
    });
  });
});
