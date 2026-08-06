import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { SecretCipher } from '../../../../domain/ports/SecretCipher.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const KEY_VERSION_LENGTH_BYTES = 1;
const MIN_PAYLOAD_LENGTH_BYTES = KEY_VERSION_LENGTH_BYTES + IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES;

/**
 * The only `SecretCipher` implementation allowed to touch Node's native
 * `crypto` module (design D13) — AES-256-GCM, one key per instance. Wire
 * format is `keyVersion(1)‖IV(12)‖authTag(16)‖ciphertext`, base64url-encoded,
 * so a single opaque string carries everything `decrypt` needs.
 *
 * The raw `TOKEN_SECRET` (operator-supplied, any length) is normalized to a
 * 32-byte AES-256 key via SHA-256 — `createCipheriv('aes-256-gcm', ...)`
 * requires exactly 32 bytes, and operators should not have to hand-craft a
 * key of that exact length.
 */
export class AesGcmSecretCipher implements SecretCipher {
  private readonly key: Buffer;

  constructor(
    tokenSecret: string,
    private readonly keyVersion: number,
  ) {
    this.key = createHash('sha256').update(tokenSecret, 'utf8').digest();
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const keyVersionByte = Buffer.from([this.keyVersion]);
    return Buffer.concat([keyVersionByte, iv, authTag, ciphertext]).toString('base64url');
  }

  /** Never throws — any tamper/format/wrong-key/authTag failure becomes `null` (design D13). */
  decrypt(ciphertext: string): string | null {
    try {
      const payload = Buffer.from(ciphertext, 'base64url');
      if (payload.length < MIN_PAYLOAD_LENGTH_BYTES) {
        return null;
      }

      const keyVersion = payload.readUInt8(0);
      if (keyVersion !== this.keyVersion) {
        return null;
      }

      const ivStart = KEY_VERSION_LENGTH_BYTES;
      const authTagStart = ivStart + IV_LENGTH_BYTES;
      const ciphertextStart = authTagStart + AUTH_TAG_LENGTH_BYTES;

      const iv = payload.subarray(ivStart, authTagStart);
      const authTag = payload.subarray(authTagStart, ciphertextStart);
      const encrypted = payload.subarray(ciphertextStart);

      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return plaintext.toString('utf8');
    } catch {
      return null;
    }
  }
}
