import { weakPassword } from '../../errors/IdentityAccessError.js';

/**
 * Raw-password strength policy (password-policy). A single source of truth for
 * "is this cleartext password strong enough", asserted at EVERY entry point
 * where a new password enters the domain from transport — before it is ever
 * handed to the `PasswordHasher` (CreateUser, ChangePassword,
 * CreateOrganizationWithAdmin, ConfirmPasswordReset).
 *
 * This validates the CLEARTEXT candidate only; `PasswordCredential` remains the
 * value object for the already-hashed form. Rules are aggregated (every failing
 * rule is reported, not just the first) so the caller can fix them all at once.
 */
export const PASSWORD_MIN_LENGTH = 8;

export type PasswordPolicyReason =
  | 'MIN_LENGTH'
  | 'MISSING_LOWERCASE'
  | 'MISSING_UPPERCASE'
  | 'MISSING_DIGIT';

function checkPasswordPolicy(password: string): PasswordPolicyReason[] {
  const reasons: PasswordPolicyReason[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    reasons.push('MIN_LENGTH');
  }
  if (!/[a-z]/.test(password)) {
    reasons.push('MISSING_LOWERCASE');
  }
  if (!/[A-Z]/.test(password)) {
    reasons.push('MISSING_UPPERCASE');
  }
  if (!/[0-9]/.test(password)) {
    reasons.push('MISSING_DIGIT');
  }
  return reasons;
}

/** Throws `weakPassword(reasons)` if the cleartext password fails any rule. */
export function assertPasswordPolicy(password: string): void {
  const reasons = checkPasswordPolicy(password);
  if (reasons.length > 0) {
    throw weakPassword(reasons);
  }
}
