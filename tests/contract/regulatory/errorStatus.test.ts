import { regulatoryErrorStatus } from '../../../src/modules/regulatory/infrastructure/adapters/inbound/http/errorStatus.js';

describe('regulatoryErrorStatus', () => {
  it('maps every closed regulatory error code to its HTTP status', () => {
    expect(regulatoryErrorStatus).toEqual({
      INVARIANT_VIOLATION: 400,
      FORBIDDEN_CROSS_TENANT: 403,
      FORBIDDEN_ROLE: 403,
      REGULATORY_REPORT_NOT_FOUND: 404,
      REPORT_ALREADY_ISSUED: 409,
      INVALID_REPORTING_PERIOD: 400,
    });
  });
});
