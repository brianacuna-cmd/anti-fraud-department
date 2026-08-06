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
 * A fixed, valid bcrypt hash (cost `BCRYPT_COST`) of an unrecoverable
 * placeholder secret — no plaintext behind it is a real credential (design
 * D24). Callers that cannot resolve a real account (e.g. an unknown email
 * at login) run `verify(password, createPasswordCredential(DUMMY_PASSWORD_HASH))`
 * so the full bcrypt comparison cost is paid regardless, keeping failure
 * timing uniform between "unknown email" and "known email, wrong password"
 * and making accounts non-enumerable via response latency.
 */
export const DUMMY_PASSWORD_HASH = '$2b$12$HJHxubAWYBl4ST.K.6ZPrORSKNgkdhgb2tk.roHNQ8hq/mCCcpqx.';

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

  async verify(plainPassword: string, credential: PasswordCredential): Promise<boolean> {
    return bcrypt.compare(plainPassword, credential.passwordHash);
  }
}
