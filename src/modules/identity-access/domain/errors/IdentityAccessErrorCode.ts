/**
 * Closed set of error codes owned by the `identity-access` module (design
 * D5, ESTRUCTURA_REPO.md §2: "lista cerrada por módulo"). Extending this
 * union is a deliberate, explicit change — never an ad-hoc `throw new
 * Error(string)`.
 *
 * `INVARIANT_VIOLATION` covers value-object/DTO guard failures (design Open
 * Question, resolved): any input that never should have reached the domain.
 */
export type IdentityAccessErrorCode =
  | 'INVARIANT_VIOLATION'
  | 'INVALID_TRANSITION'
  | 'FORBIDDEN_REACTIVATION'
  | 'FORBIDDEN_CROSS_TENANT'
  | 'ORGANIZATION_SLUG_TAKEN'
  | 'ORGANIZATION_NOT_FOUND'
  | 'USER_EMAIL_TAKEN'
  | 'USER_NOT_FOUND'
  // Phase 4 (design D18, D19, D24, D29): login/logout/lockout.
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_LOCKED'
  | 'SESSION_EXPIRED'
  | 'SESSION_INVALID'
  | 'ORGANIZATION_SUSPENDED'
  // mfa-user-enrollment PR2: user MFA setup/activate/disable.
  | 'MFA_ENROLLMENT_NOT_PENDING'
  | 'MFA_TOKEN_INVALID'
  // two-step-login PR2 (design "IssueSession flow"): challenge-token
  // rejection — malformed/wrong-type/expired/unknown-jti/replayed. Wrong
  // TOTP reuses MFA_TOKEN_INVALID (same failure shape as ActivateMfa).
  | 'MFA_CHALLENGE_INVALID'
  // super-admin-auth PR1 (design "VerifyAdminChallenge"): covers every
  // rejection mode of the PLATFORM_ADMIN challenge-login uniformly — no
  // active key, unknown/expired/replayed challengeId, and a forged/invalid
  // signature all reject with this ONE code (no oracle for which failed).
  | 'ADMIN_CHALLENGE_INVALID';
