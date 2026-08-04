import { invariantViolation } from '../../errors/IdentityAccessError.js';

/**
 * The two halves of a hashed password that must always travel together
 * (design: `ScryptPasswordHasher` produces both). Neither half may be blank
 * — a credential with a blank hash or salt is never a valid persisted state.
 */
export interface PasswordCredential {
  readonly passwordHash: string;
  readonly passwordSalt: string;
}

export function createPasswordCredential(passwordHash: string, passwordSalt: string): PasswordCredential {
  if (passwordHash.trim().length === 0) {
    throw invariantViolation('PasswordCredential passwordHash must be a non-empty string', { passwordHash });
  }
  if (passwordSalt.trim().length === 0) {
    throw invariantViolation('PasswordCredential passwordSalt must be a non-empty string', { passwordSalt });
  }
  return { passwordHash, passwordSalt };
}
