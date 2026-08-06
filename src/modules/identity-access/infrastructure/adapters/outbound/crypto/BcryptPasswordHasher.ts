import bcrypt from 'bcryptjs';
import type { PasswordHasher } from '../../../../domain/ports/PasswordHasher.js';
import { createPasswordCredential, type PasswordCredential } from '../../../../domain/model/value-objects/PasswordCredential.js';

/**
 * Cost factor for `bcrypt.hash` (design A4). Named so the hashing-latency
 * vs. brute-force-resistance trade-off is visible and adjustable in one
 * place rather than a magic number scattered across call sites.
 */
export const BCRYPT_COST = 12;

/**
 * The only `PasswordHasher` implementation allowed to touch `bcryptjs`
 * (design A4). bcrypt hashes are self-salted — the same password produces a
 * different hash on every call — so `PasswordCredential` carries just the
 * one `passwordHash` field. Note: bcrypt truncates its input at 72 bytes,
 * so any bytes past that are ignored when hashing and verifying.
 */
export class BcryptPasswordHasher implements PasswordHasher {
  async hash(plainPassword: string): Promise<PasswordCredential> {
    const passwordHash = await bcrypt.hash(plainPassword, BCRYPT_COST);
    return createPasswordCredential(passwordHash);
  }
}
