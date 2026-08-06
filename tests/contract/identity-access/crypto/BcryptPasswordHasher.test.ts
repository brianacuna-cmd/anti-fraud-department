import bcrypt from 'bcryptjs';
import {
  BcryptPasswordHasher,
  BCRYPT_COST,
} from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/BcryptPasswordHasher.js';

describe('BcryptPasswordHasher', () => {
  it('produces a non-blank hash that verifies against the original password', async () => {
    const hasher = new BcryptPasswordHasher();

    const credential = await hasher.hash('super-secret');

    expect(credential.passwordHash.length).toBeGreaterThan(0);
    await expect(bcrypt.compare('super-secret', credential.passwordHash)).resolves.toBe(true);
  });

  it('does not verify against a different password', async () => {
    const hasher = new BcryptPasswordHasher();

    const credential = await hasher.hash('super-secret');

    await expect(bcrypt.compare('not-the-secret', credential.passwordHash)).resolves.toBe(false);
  });

  it('produces a different hash on every call for the same password (bcrypt is self-salted)', async () => {
    const hasher = new BcryptPasswordHasher();

    const first = await hasher.hash('super-secret');
    const second = await hasher.hash('super-secret');

    expect(first.passwordHash).not.toBe(second.passwordHash);
  });

  it('is hashed with cost factor BCRYPT_COST=12, embedded in the hash prefix', async () => {
    const hasher = new BcryptPasswordHasher();

    const credential = await hasher.hash('super-secret');

    expect(BCRYPT_COST).toBe(12);
    expect(credential.passwordHash).toMatch(/^\$2[aby]\$12\$/);
  });

  it('truncates input at 72 bytes: passwords sharing the first 72 bytes verify as equivalent', async () => {
    const hasher = new BcryptPasswordHasher();
    const shared72Bytes = 'a'.repeat(72);
    const passwordA = `${shared72Bytes}tail-one`;
    const passwordB = `${shared72Bytes}a-completely-different-tail`;

    const credential = await hasher.hash(passwordA);

    // bcrypt only reads the first 72 bytes — anything past that is ignored,
    // so a password differing only after byte 72 still "verifies".
    await expect(bcrypt.compare(passwordB, credential.passwordHash)).resolves.toBe(true);
  });
});
