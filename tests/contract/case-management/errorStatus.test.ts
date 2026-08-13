import { caseManagementErrorStatus } from '../../../src/modules/case-management/infrastructure/adapters/inbound/http/errorStatus.js';
import { caseNotFound } from '../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import type { CaseManagementErrorCode } from '../../../src/modules/case-management/domain/errors/CaseManagementErrorCode.js';

describe('caseManagementErrorStatus', () => {
  it('maps every closed case-management error code to its HTTP status', () => {
    expect(caseManagementErrorStatus).toEqual({
      INVARIANT_VIOLATION: 400,
      INVALID_TRANSITION: 422,
      FORBIDDEN_CROSS_TENANT: 403,
      ORGANIZATION_FRAUD_CONFIG_NOT_FOUND: 404,
      CASE_NOT_FOUND: 404,
    });
  });

  it('caseNotFound factory produces CASE_NOT_FOUND with the case id', () => {
    const error = caseNotFound('case-abc');
    expect(error.code).toBe('CASE_NOT_FOUND' satisfies CaseManagementErrorCode);
    expect(error.message).toContain('case-abc');
    expect(error.metadata).toEqual({ caseId: 'case-abc' });
  });
});
