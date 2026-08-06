import type { PasswordCredential } from '../model/value-objects/PasswordCredential.js';

/**
 * Port for hashing a plaintext password into a storable
 * `PasswordCredential` (design A4: bcrypt). Domain/application code never
 * touches `bcryptjs` directly — the concrete algorithm lives in
 * `BcryptPasswordHasher` (infrastructure).
 */
export interface PasswordHasher {
  hash(plainPassword: string): Promise<PasswordCredential>;
}
