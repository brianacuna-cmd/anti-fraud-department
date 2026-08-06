/**
 * Symmetric encryption for secrets at rest (design D13). Used directly for
 * `MfaSecret` encryption (mfa-totp spec: "MfaSecret Encrypted at Rest"), and
 * composed by `SessionTokenService` for opaque token issuance — exactly ONE
 * AES-256-GCM primitive backs every consumer through this one port.
 *
 * NOTE for `identity-access-super-admin-auth`: this port shape is the exact
 * contract that change's Ed25519 private-key encryption depends on. It is
 * stable as of this revision — `encrypt`/`decrypt` only, `decrypt` never
 * throws.
 */
export interface SecretCipher {
  /** Encrypts `plaintext`, returning an opaque, self-contained ciphertext string. */
  encrypt(plaintext: string): string;

  /**
   * Decrypts `ciphertext`. Returns `null` — NEVER throws — on any tamper,
   * malformed-input, wrong-key, or authentication-tag failure, so callers
   * cannot leak key material or crypto internals through an exception.
   */
  decrypt(ciphertext: string): string | null;
}
