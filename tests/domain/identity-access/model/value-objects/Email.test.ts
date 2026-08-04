import { createEmail } from '../../../../../src/modules/identity-access/domain/model/value-objects/Email.js';

describe('createEmail', () => {
  it('accepts a well-formed email and returns it unchanged', () => {
    const email = createEmail('alice@example.com');

    expect(email).toBe('alice@example.com');
  });

  it('accepts a well-formed email with a subdomain and plus-tag', () => {
    const email = createEmail('alice+ops@mail.example.com');

    expect(email).toBe('alice+ops@mail.example.com');
  });

  it('rejects an empty string as an invariant violation', () => {
    expect(() => createEmail('')).toThrow(/Email/);
  });

  it('rejects a string without an @ as an invariant violation', () => {
    expect(() => createEmail('alice.example.com')).toThrow(/Email/);
  });

  it('rejects a string with no domain after @ as an invariant violation', () => {
    expect(() => createEmail('alice@')).toThrow(/Email/);
  });

  it('rejects a string with spaces as an invariant violation', () => {
    expect(() => createEmail('alice bob@example.com')).toThrow(/Email/);
  });
});
