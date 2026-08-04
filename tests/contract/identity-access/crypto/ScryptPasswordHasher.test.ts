import { ScryptPasswordHasher } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/ScryptPasswordHasher.js';

describe('ScryptPasswordHasher', () => {
  it('produces a non-blank hash and salt for a given password', async () => {
    const hasher = new ScryptPasswordHasher();

    const credential = await hasher.hash('super-secret');

    expect(credential.passwordHash.length).toBeGreaterThan(0);
    expect(credential.passwordSalt.length).toBeGreaterThan(0);
  });

  it('produces a different salt (and therefore hash) on every call, even for the same password', async () => {
    const hasher = new ScryptPasswordHasher();

    const first = await hasher.hash('super-secret');
    const second = await hasher.hash('super-secret');

    expect(first.passwordSalt).not.toBe(second.passwordSalt);
    expect(first.passwordHash).not.toBe(second.passwordHash);
  });
});
