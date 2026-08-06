import {
  createAdminKeyId,
  generateAdminKeyId,
} from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminKeyId.js';

describe('createAdminKeyId', () => {
  it('accepts a non-empty string and returns it unchanged', () => {
    const id = createAdminKeyId('key-123');

    expect(id).toBe('key-123');
  });

  it('rejects an empty string as an invariant violation', () => {
    expect(() => createAdminKeyId('')).toThrow(/non-empty/);
  });

  it('rejects a whitespace-only string as an invariant violation', () => {
    expect(() => createAdminKeyId('   ')).toThrow(/non-empty/);
  });
});

describe('generateAdminKeyId', () => {
  it('generates a fresh, non-empty id on every call', () => {
    const first = generateAdminKeyId();
    const second = generateAdminKeyId();

    expect(first.length).toBeGreaterThan(0);
    expect(first).not.toBe(second);
  });
});
