import { createPasswordCredential } from '../../../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';

describe('createPasswordCredential', () => {
  it('carries the given hash unchanged', () => {
    const credential = createPasswordCredential('hash-value');

    expect(credential.passwordHash).toBe('hash-value');
  });

  it('rejects a blank passwordHash as an invariant violation', () => {
    expect(() => createPasswordCredential('   ')).toThrow(/PasswordCredential/);
  });
});
