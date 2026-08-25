import { identityAccessErrorStatus } from '../../../src/modules/identity-access/infrastructure/adapters/inbound/http/errorStatus.js';

describe('identityAccessErrorStatus', () => {
  it('maps every closed identity-access error code to its HTTP status (design errorStatus map)', () => {
    expect(identityAccessErrorStatus).toEqual({
      // requireAuthContext with no resolved AuthContext (missing/invalid token).
      UNAUTHENTICATED: 401,
      INVALID_TRANSITION: 422,
      FORBIDDEN_REACTIVATION: 403,
      FORBIDDEN_CROSS_TENANT: 403,
      // role-authorization: the USER actor's role does not allow the operation.
      FORBIDDEN_ROLE: 403,
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
      // two-step-login PR1a (design D3): shared AuthScopeError's code.
      FORBIDDEN_AUTH_SCOPE: 403,
      // two-step-login PR2 (design "IssueSession flow"): challenge-token rejection.
      MFA_CHALLENGE_INVALID: 401,
      // super-admin-auth PR1 (design "VerifyAdminChallenge"): PLATFORM_ADMIN
      // challenge-login rejection.
      ADMIN_CHALLENGE_INVALID: 401,
      // super-admin-auth PR2 (design "PR-2 key lifecycle"): authenticated
      // key-lifecycle rejections.
      ADMIN_ORGANIZATION_NOT_FOUND: 404,
      ADMIN_PRIVATE_KEY_UNAVAILABLE: 409,
      // password-management PR-2a (design "HTTP + DTOs + main.ts"): uniform
      // reset-token rejection (expired/replayed/mismatch/user-missing).
      PASSWORD_RESET_INVALID: 400,
      // user-roles PR-1b (design "5. `CreateUser` use case changes"): invalid
      // role request.
      ROLE_NOT_ASSIGNABLE: 400,
      // password-policy: chosen password fails the strength rules.
      WEAK_PASSWORD: 422,
    });
  });
});
