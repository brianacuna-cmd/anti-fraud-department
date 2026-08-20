import {
  createAdminKeyId,
  generateAdminKeyId,
} from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminKeyId.js';

const HEX = 'a'.repeat(24);

describe('createAdminKeyId', () => {
  it('accepts a 24-character hexadecimal ObjectId', () => {
    expect(createAdminKeyId(HEX)).toBe(HEX);
  });

  it('rejects a value that is not a 24-character hex ObjectId', () => {
    expect(() => createAdminKeyId('')).toThrow(/24-character hexadecimal ObjectId/);
    expect(() => createAdminKeyId('not-an-objectid')).toThrow(/24-character hexadecimal ObjectId/);
  });
});

describe('generateAdminKeyId', () => {
  it('generates a unique 24-char hex id on every call', () => {
    const first = generateAdminKeyId();
    const second = generateAdminKeyId();

    expect(first).toMatch(/^[a-f0-9]{24}$/);
    expect(first).not.toBe(second);
  });
});
