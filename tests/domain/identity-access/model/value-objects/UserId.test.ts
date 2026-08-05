import {
  createUserId,
  generateUserId,
} from '../../../../../src/modules/identity-access/domain/model/value-objects/UserId.js';

describe('createUserId', () => {
  it('accepts a non-empty string and returns it unchanged', () => {
    const id = createUserId('user-123');

    expect(id).toBe('user-123');
  });

  it('rejects an empty string as an invariant violation', () => {
    expect(() => createUserId('')).toThrow(/non-empty/);
  });

  it('rejects a whitespace-only string as an invariant violation', () => {
    expect(() => createUserId('   ')).toThrow(/non-empty/);
  });
});

describe('generateUserId', () => {
  it('generates a fresh, non-empty id on every call', () => {
    const first = generateUserId();
    const second = generateUserId();

    expect(first.length).toBeGreaterThan(0);
    expect(first).not.toBe(second);
  });
});
