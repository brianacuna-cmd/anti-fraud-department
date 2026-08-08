import type { StatusByCode } from '../../../../../../shared/http/errorHandler.js';

/**
 * Code -> HTTP status for every closed `IdentityAccessErrorCode` (design:
 * "errorStatus map"). Lives in the HTTP layer, never on the domain error
 * itself (design D5).
 */
export const identityAccessErrorStatus: StatusByCode = {
  INVALID_TRANSITION: 422,
  FORBIDDEN_REACTIVATION: 403,
  FORBIDDEN_CROSS_TENANT: 403,
  ORGANIZATION_SLUG_TAKEN: 409,
  USER_EMAIL_TAKEN: 409,
  ORGANIZATION_NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  INVARIANT_VIOLATION: 400,
  // Phase 4 (design D18, D19, D24, D29): login/logout/lockout.
  INVALID_CREDENTIALS: 401,
  ACCOUNT_LOCKED: 423,
  SESSION_EXPIRED: 401,
  SESSION_INVALID: 401,
  ORGANIZATION_SUSPENDED: 403,
  // mfa-user-enrollment PR2: user MFA setup/activate/disable.
  MFA_ENROLLMENT_NOT_PENDING: 409,
  MFA_TOKEN_INVALID: 401,
  // two-step-login PR2 (design "IssueSession flow"): challenge-token rejection.
  MFA_CHALLENGE_INVALID: 401,
  // super-admin-auth PR1 (design "VerifyAdminChallenge"): PLATFORM_ADMIN
  // challenge-login rejection — same 401 shape as MFA_CHALLENGE_INVALID.
  ADMIN_CHALLENGE_INVALID: 401,
  // super-admin-auth PR2 (design "PR-2 key lifecycle"): authenticated
  // key-lifecycle rejections.
  ADMIN_ORGANIZATION_NOT_FOUND: 404,
  ADMIN_PRIVATE_KEY_UNAVAILABLE: 409,
  // two-step-login PR1a (design D3): thrown by shared `AuthScopeError` — not
  // an `IdentityAccessErrorCode` (it lives in `shared/kernel`, not this
  // module's closed error set) but `errorHandler` matches any `DomainError`
  // subclass by `code` string, so this entry maps it regardless of layer.
  FORBIDDEN_AUTH_SCOPE: 403,
};
