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
  | 'FORBIDDEN_ROLE'
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
  | 'ADMIN_CHALLENGE_INVALID'
  // super-admin-auth PR2 (design "PR-2 key lifecycle"): authenticated
  // (requirePlatformAdmin-gated) key-lifecycle rejections — these are NOT
  // opaque like ADMIN_CHALLENGE_INVALID because the caller is already an
  // authenticated platform admin, so there is no enumeration oracle to hide.
  | 'ADMIN_ORGANIZATION_NOT_FOUND'
  | 'ADMIN_PRIVATE_KEY_UNAVAILABLE'
  // password-management PR-2a (design "HTTP + DTOs + main.ts"): reset-token
  // rejection — expired/replayed/mismatch/user-missing all reject with this
  // ONE code (no oracle for which failed), consumed by PR-2c's confirm flow.
  | 'PASSWORD_RESET_INVALID'
  // user-roles PR-1b (design "5. `CreateUser` use case changes"): a
  // requested `roleId` that does not resolve to an existing, Active,
  // user-assignable role — ADMIN, unknown, and inactive all funnel here (no
  // oracle for which failed; caller is already an authenticated ORGANIZATION).
  | 'ROLE_NOT_ASSIGNABLE'
  // password-policy: a raw (pre-hash) password that fails the strength policy
  // — length/character-class rules, checked at every entry point where a NEW
  // password enters from transport (CreateUser, ChangePassword,
  // CreateOrganizationWithAdmin, ConfirmPasswordReset). The failing rules are
  // aggregated in `metadata.reasons`; safe to surface since a caller choosing
  // their OWN password is not an enumeration oracle.
  | 'WEAK_PASSWORD';
