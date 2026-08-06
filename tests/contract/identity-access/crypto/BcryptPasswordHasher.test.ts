import bcrypt from 'bcryptjs';
import {
  BcryptPasswordHasher,
  BCRYPT_COST,
  DUMMY_PASSWORD_HASH,
} from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/BcryptPasswordHasher.js';
import { createPasswordCredential } from '../../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';

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

  describe('verify()', () => {
    it('returns true for the correct password against its own credential', async () => {
      const hasher = new BcryptPasswordHasher();
      const credential = await hasher.hash('super-secret');

      await expect(hasher.verify('super-secret', credential)).resolves.toBe(true);
    });

    it('returns false for an incorrect password against an existing credential', async () => {
      const hasher = new BcryptPasswordHasher();
      const credential = await hasher.hash('super-secret');

      await expect(hasher.verify('not-the-secret', credential)).resolves.toBe(false);
    });

    it('returns false, never throws, when compared against DUMMY_PASSWORD_HASH (unknown-email dummy verify, D24)', async () => {
      const hasher = new BcryptPasswordHasher();
      const dummyCredential = createPasswordCredential(DUMMY_PASSWORD_HASH);

      await expect(hasher.verify('any-password-at-all', dummyCredential)).resolves.toBe(false);
    });

    it('DUMMY_PASSWORD_HASH is a well-formed bcrypt hash at BCRYPT_COST, so its compare takes real bcrypt work', async () => {
      expect(DUMMY_PASSWORD_HASH).toMatch(/^\$2[aby]\$12\$/);
    });

    it('takes comparable time verifying against DUMMY_PASSWORD_HASH as against a real credential (no short-circuit)', async () => {
      const hasher = new BcryptPasswordHasher();
      const realCredential = await hasher.hash('super-secret');
      const dummyCredential = createPasswordCredential(DUMMY_PASSWORD_HASH);

      const realStart = process.hrtime.bigint();
      await hasher.verify('wrong-password', realCredential);
      const realDurationMs = Number(process.hrtime.bigint() - realStart) / 1_000_000;

      const dummyStart = process.hrtime.bigint();
      await hasher.verify('wrong-password', dummyCredential);
      const dummyDurationMs = Number(process.hrtime.bigint() - dummyStart) / 1_000_000;

      // Both go through the full bcrypt.compare algorithm at the same cost
      // factor — neither should be an order of magnitude faster than the
      // other, which is what a short-circuiting "unknown account" branch
      // would produce and exactly what D24's dummy-verify exists to avoid.
      expect(dummyDurationMs).toBeGreaterThan(realDurationMs / 10);
    });
  });
});
