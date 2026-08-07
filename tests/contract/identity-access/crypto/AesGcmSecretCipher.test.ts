import { AesGcmSecretCipher } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';

describe('AesGcmSecretCipher', () => {
  it('round-trips a plaintext through encrypt/decrypt', () => {
    const cipher = new AesGcmSecretCipher('correct-horse-battery-staple', 1);

    const ciphertext = cipher.encrypt('a very secret TOTP seed');

    expect(cipher.decrypt(ciphertext)).toBe('a very secret TOTP seed');
  });

  it('produces a different ciphertext on every call for the same plaintext (random IV)', () => {
    const cipher = new AesGcmSecretCipher('correct-horse-battery-staple', 1);

    const first = cipher.encrypt('same plaintext');
    const second = cipher.encrypt('same plaintext');

    expect(first).not.toBe(second);
    expect(cipher.decrypt(first)).toBe('same plaintext');
    expect(cipher.decrypt(second)).toBe('same plaintext');
  });

  it('returns null, never throws, when the authTag/ciphertext has been tampered with', () => {
    const cipher = new AesGcmSecretCipher('correct-horse-battery-staple', 1);
    const ciphertext = cipher.encrypt('tamper me');
    const raw = Buffer.from(ciphertext, 'base64url');
    raw[raw.length - 1] = (raw[raw.length - 1]! ^ 0xff) & 0xff;
    const tampered = raw.toString('base64url');

    expect(cipher.decrypt(tampered)).toBeNull();
  });

  it('returns null for malformed/garbage input instead of throwing', () => {
    const cipher = new AesGcmSecretCipher('correct-horse-battery-staple', 1);

    expect(cipher.decrypt('not-a-valid-payload')).toBeNull();
    expect(cipher.decrypt('')).toBeNull();
  });

  it('returns null when decrypting with a different key (wrong secret)', () => {
    const encrypter = new AesGcmSecretCipher('secret-one', 1);
    const decrypter = new AesGcmSecretCipher('secret-two', 1);

    const ciphertext = encrypter.encrypt('cross-key attempt');

    expect(decrypter.decrypt(ciphertext)).toBeNull();
  });

  it('returns null when the embedded keyVersion does not match this instance', () => {
    const encrypter = new AesGcmSecretCipher('correct-horse-battery-staple', 1);
    const decrypter = new AesGcmSecretCipher('correct-horse-battery-staple', 2);

    const ciphertext = encrypter.encrypt('versioned secret');

    expect(decrypter.decrypt(ciphertext)).toBeNull();
  });
});
