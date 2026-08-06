import type { PasswordCredential } from '../model/value-objects/PasswordCredential.js';

/**
 * Port for hashing and verifying a plaintext password against a storable
 * `PasswordCredential` (design A4/D24: bcrypt). Domain/application code
 * never touches `bcryptjs` directly — the concrete algorithm lives in
 * `BcryptPasswordHasher` (infrastructure).
 */
export interface PasswordHasher {
  hash(plainPassword: string): Promise<PasswordCredential>;

  /**
   * Compares `plainPassword` against a stored `credential`. Callers that
   * cannot resolve a real account (e.g. an unknown-email login) MUST still
   * call this against a dummy credential — see `DUMMY_PASSWORD_HASH` in
   * `BcryptPasswordHasher` — so failed lookups take comparable time to a
   * genuine wrong-password check and cannot be used to enumerate accounts.
   */
  verify(plainPassword: string, credential: PasswordCredential): Promise<boolean>;
}
