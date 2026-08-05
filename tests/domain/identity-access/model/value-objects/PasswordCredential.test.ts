import { createPasswordCredential } from '../../../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';

describe('createPasswordCredential', () => {
  it('carries the given hash and salt unchanged', () => {
    const credential = createPasswordCredential('hash-value', 'salt-value');

    expect(credential.passwordHash).toBe('hash-value');
    expect(credential.passwordSalt).toBe('salt-value');
  });

  it('rejects a blank passwordHash as an invariant violation', () => {
    expect(() => createPasswordCredential('   ', 'salt-value')).toThrow(/PasswordCredential/);
  });

  it('rejects a blank passwordSalt as an invariant violation', () => {
    expect(() => createPasswordCredential('hash-value', '   ')).toThrow(/PasswordCredential/);
  });
});
