/**
 * Symmetric encryption for inbound webhook secrets at rest. Clone of the
 * identity-access `SecretCipher` contract — ingest must not import that
 * module. Wire the same `AesGcmSecretCipher` instance from `main.ts` later.
 *
 * `decrypt` never throws: returns `null` on tamper, malformed input,
 * wrong-key, or authentication-tag failure.
 */
export interface SecretCipher {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string | null;
}
