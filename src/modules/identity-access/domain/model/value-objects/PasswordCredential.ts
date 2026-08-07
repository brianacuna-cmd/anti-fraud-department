import { invariantViolation } from '../../errors/IdentityAccessError.js';

/**
 * A hashed password ready for persistence (design A4). `BcryptPasswordHasher`
 * produces self-salted bcrypt hashes, so there is no separate salt half to
 * carry alongside it — a vestigial salt field would just be a lie the
 * mapper has to fabricate. The hash may never be blank.
 */
export interface PasswordCredential {
  readonly passwordHash: string;
}

export function createPasswordCredential(passwordHash: string): PasswordCredential {
  if (passwordHash.trim().length === 0) {
    throw invariantViolation('PasswordCredential passwordHash must be a non-empty string', { passwordHash });
  }
  return { passwordHash };
}
