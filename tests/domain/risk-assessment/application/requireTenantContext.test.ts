import { requireTenantContext } from '../../../../src/modules/risk-assessment/application/authorization/requireTenantContext.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { RiskAssessmentError } from '../../../../src/modules/risk-assessment/domain/errors/RiskAssessmentError.js';

describe('requireTenantContext (risk-assessment)', () => {
  it('returns the organizationId when the actor has a tenant context', () => {
    const auth = createAuthContext({ userId: 'user-1', organizationId: 'org-1' });

    expect(requireTenantContext(auth)).toBe('org-1');
  });

  it('rejects a null organizationId with FORBIDDEN_CROSS_TENANT', () => {
    const auth = createAuthContext({
      userId: 'admin-1',
      organizationId: null,
      actorType: 'PLATFORM_ADMIN',
    });

    expect.assertions(2);
    try {
      requireTenantContext(auth);
    } catch (error) {
      expect(error).toBeInstanceOf(RiskAssessmentError);
      expect((error as RiskAssessmentError).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
  });
});
