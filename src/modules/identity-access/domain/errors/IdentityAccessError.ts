import { DomainError } from '../../../../shared/kernel/DomainError.js';
import type { IdentityAccessErrorCode } from './IdentityAccessErrorCode.js';

/**
 * The one concrete `DomainError` subtype for the whole `identity-access`
 * module (design D5). HTTP status mapping lives in the HTTP layer
 * (`infrastructure/adapters/inbound/http/errorStatus.ts`), never here.
 */
export class IdentityAccessError extends DomainError {
  constructor(
    code: IdentityAccessErrorCode,
    message: string,
    metadata: Readonly<Record<string, unknown>> = {},
  ) {
    super(code, message, metadata);
  }
}

export function invariantViolation(
  message: string,
  metadata: Readonly<Record<string, unknown>> = {},
): IdentityAccessError {
  return new IdentityAccessError('INVARIANT_VIOLATION', message, metadata);
}

export function invalidTransition(current: string, next: string): IdentityAccessError {
  return new IdentityAccessError(
    'INVALID_TRANSITION',
    `cannot transition from "${current}" to "${next}"`,
    { current, next },
  );
}

export function forbiddenReactivation(current: string, next: string): IdentityAccessError {
  return new IdentityAccessError(
    'FORBIDDEN_REACTIVATION',
    `reactivation from "${current}" to "${next}" requires a platform administrator`,
    { current, next },
  );
}

export function forbiddenCrossTenant(
  message = 'actor is not authorized to perform this cross-tenant operation',
): IdentityAccessError {
  return new IdentityAccessError('FORBIDDEN_CROSS_TENANT', message);
}

export function organizationSlugTaken(slug: string): IdentityAccessError {
  return new IdentityAccessError('ORGANIZATION_SLUG_TAKEN', `slug "${slug}" is already in use`, {
    slug,
  });
}

export function organizationNotFound(id: string): IdentityAccessError {
  return new IdentityAccessError('ORGANIZATION_NOT_FOUND', `organization "${id}" not found`, {
    id,
  });
}

export function userEmailTaken(email: string): IdentityAccessError {
  // Callers span two different scopes: same-organization duplicate checks
  // (CreateUser, PatchUserIdentity, MongoUserRepository) and the
  // cross-tenant "duplicate admin email anywhere" bootstrap check
  // (CreateOrganizationWithAdmin) — the message stays scope-neutral so it
  // never claims a scope narrower than the check that actually ran.
  return new IdentityAccessError('USER_EMAIL_TAKEN', `email "${email}" is already in use`, { email });
}

export function userNotFound(id: string): IdentityAccessError {
  return new IdentityAccessError('USER_NOT_FOUND', `user "${id}" not found`, { id });
}

// Phase 4 (design D18, D19, D24, D29): login/logout/lockout.

/**
 * Deliberately generic (design account-lockout/authentication-session specs
 * "Wrong password rejected uniformly" / "No Email-Existence Leak"): the same
 * error for an unknown email, a wrong password on a known email, and a
 * suspended/cancelled/not-found tenant slug — the response must never leak
 * which of those actually happened.
 */
export function invalidCredentials(): IdentityAccessError {
  return new IdentityAccessError('INVALID_CREDENTIALS', 'invalid email or password');
}

export function accountLocked(blockedUntil: string): IdentityAccessError {
  return new IdentityAccessError('ACCOUNT_LOCKED', `account is locked until ${blockedUntil}`, { blockedUntil });
}

export function sessionExpired(): IdentityAccessError {
  return new IdentityAccessError('SESSION_EXPIRED', 'session has expired');
}

export function sessionInvalid(): IdentityAccessError {
  return new IdentityAccessError('SESSION_INVALID', 'session is invalid or has been revoked');
}

export function organizationSuspended(): IdentityAccessError {
  return new IdentityAccessError('ORGANIZATION_SUSPENDED', 'organization is suspended');
}

// password-management PR-1: authenticated change-password.

/**
 * The submitted `currentPassword` did not match the stored credential.
 * Reuses `INVALID_CREDENTIALS` (same code/status as a failed login) — the
 * caller is already authenticated here, so there is no enumeration oracle
 * to hide, but the credential-mismatch shape is identical to login's.
 */
export function invalidCurrentPassword(): IdentityAccessError {
  return new IdentityAccessError('INVALID_CREDENTIALS', 'current password is incorrect');
}

// password-management PR-2a: reset-token rejection (consumed by PR-2c's
// ConfirmPasswordReset).

/**
 * ONE opaque error for every way a password-reset confirmation can fail:
 * malformed/wrong-type token, self-expired, wrong-tenant, jti mismatch
 * (already-used/replayed, or superseded by a later reset/password change),
 * or the user it claims no longer resolves — every one of those failure
 * modes must be INDISTINGUISHABLE to the caller (spec: "All rejections
 * assert uniform PASSWORD_RESET_INVALID 400"), same "no oracle" precedent
 * as `mfaChallengeInvalid`/`adminChallengeInvalid`.
 */
export function passwordResetInvalid(): IdentityAccessError {
  return new IdentityAccessError('PASSWORD_RESET_INVALID', 'password reset token is invalid, expired, or already used');
}

// user-roles PR-1b: organization-only role assignment on user creation.

/**
 * ONE code for every way a requested role can fail to be assigned to a
 * `User` — unknown id, inactive role, or ADMIN (never a User's role) — the
 * caller is already an authenticated ORGANIZATION actor, so there is no
 * enumeration oracle to hide (same non-opaque precedent as
 * `adminOrganizationNotFound`).
 */
export function roleNotAssignable(roleId: string): IdentityAccessError {
  return new IdentityAccessError('ROLE_NOT_ASSIGNABLE', `role "${roleId}" is not assignable to a user`, { roleId });
}

// mfa-user-enrollment PR2: user MFA setup/activate/disable.

/** No pending TOTP secret to confirm — enrollment was never started, or is already enabled. */
export function mfaEnrollmentNotPending(): IdentityAccessError {
  return new IdentityAccessError('MFA_ENROLLMENT_NOT_PENDING', 'no pending MFA enrollment to confirm');
}

/** The submitted TOTP token failed verification against the pending/enabled secret. */
export function mfaTokenInvalid(): IdentityAccessError {
  return new IdentityAccessError('MFA_TOKEN_INVALID', 'MFA token is invalid or expired');
}

// two-step-login PR2 (design "IssueSession flow"): challenge-token rejection.

/**
 * The submitted `mfa_challenge` token is malformed, the wrong token type,
 * self-expired, references an unknown/expired/already-consumed jti, or the
 * user it claims no longer resolves — every one of those failure modes must
 * be INDISTINGUISHABLE to the caller (spec: replay/expired/unknown-jti all
 * reject uniformly), so ONE error covers all of them.
 */
export function mfaChallengeInvalid(): IdentityAccessError {
  return new IdentityAccessError('MFA_CHALLENGE_INVALID', 'MFA challenge is invalid, expired, or already used');
}

// super-admin-auth PR1 (design "VerifyAdminChallenge"): PLATFORM_ADMIN
// challenge-login rejection.

/**
 * ONE opaque error for every way a PLATFORM_ADMIN challenge-login can fail:
 * no `AdminOrganization`/no ACTIVE key for `RequestAdminChallenge`, and
 * unknown/expired/already-consumed `challengeId` OR a forged/invalid
 * signature for `VerifyAdminChallenge`. Deliberately indistinguishable
 * (mirrors `mfaChallengeInvalid`'s "no oracle" precedent) — a caller must
 * never be able to tell "wrong signature" from "challenge already used"
 * from "admin has no active key".
 */
export function adminChallengeInvalid(): IdentityAccessError {
  return new IdentityAccessError('ADMIN_CHALLENGE_INVALID', 'admin challenge is invalid, expired, or already used');
}

// super-admin-auth PR2 (design "PR-2 key lifecycle"): download/rotate/revoke,
// all `requirePlatformAdmin`-gated — callers are already-authenticated
// platform admins, so these are ordinary (non-opaque) not-found/conflict
// errors, unlike the public challenge-login errors above.

export function adminOrganizationNotFound(id: string): IdentityAccessError {
  return new IdentityAccessError('ADMIN_ORGANIZATION_NOT_FOUND', `admin organization "${id}" not found`, { id });
}

/**
 * The one-time private-key download claim (design D32a `claimPrivateKey`)
 * lost the CAS race, or the target key never had a downloadable ciphertext
 * (unknown keyId, or already downloaded by a prior/concurrent caller) — all
 * indistinguishable to the caller, since the CAS itself is the sole source
 * of truth for "was this the winning claim".
 */
export function adminPrivateKeyUnavailable(): IdentityAccessError {
  return new IdentityAccessError(
    'ADMIN_PRIVATE_KEY_UNAVAILABLE',
    'admin private key is unavailable for download (unknown key, or already downloaded)',
  );
}
