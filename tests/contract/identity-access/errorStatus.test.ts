import { identityAccessErrorStatus } from '../../../src/modules/identity-access/infrastructure/adapters/inbound/http/errorStatus.js';

describe('identityAccessErrorStatus', () => {
  it('maps every closed identity-access error code to its HTTP status (design errorStatus map)', () => {
    expect(identityAccessErrorStatus).toEqual({
      INVALID_TRANSITION: 422,
      FORBIDDEN_REACTIVATION: 403,
      FORBIDDEN_CROSS_TENANT: 403,
      ORGANIZATION_SLUG_TAKEN: 409,
      USER_EMAIL_TAKEN: 409,
      ORGANIZATION_NOT_FOUND: 404,
      USER_NOT_FOUND: 404,
      INVARIANT_VIOLATION: 400,
      // Phase 4 (design D18, D19, D24, D29): login/logout/lockout codes.
      INVALID_CREDENTIALS: 401,
      ACCOUNT_LOCKED: 423,
      SESSION_EXPIRED: 401,
      SESSION_INVALID: 401,
      ORGANIZATION_SUSPENDED: 403,
      // mfa-user-enrollment PR2: user MFA setup/activate/disable.
      MFA_ENROLLMENT_NOT_PENDING: 409,
      MFA_TOKEN_INVALID: 401,
    });
  });
});
