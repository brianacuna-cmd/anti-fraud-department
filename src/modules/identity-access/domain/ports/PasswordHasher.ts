import type { PasswordCredential } from '../model/value-objects/PasswordCredential.js';

/**
 * Port for hashing a plaintext password into a storable
 * `PasswordCredential` (design: "scrypt hash"). Domain/application code
 * never touches `node:crypto` directly — the concrete algorithm lives in
 * `ScryptPasswordHasher` (infrastructure).
 */
export interface PasswordHasher {
  hash(plainPassword: string): Promise<PasswordCredential>;
}
