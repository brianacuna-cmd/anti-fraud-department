import {
  createUserId,
  generateUserId,
} from '../../../../../src/modules/identity-access/domain/model/value-objects/UserId.js';

const HEX = 'a'.repeat(24);

describe('createUserId', () => {
  it('accepts a 24-character hexadecimal ObjectId', () => {
    expect(createUserId(HEX)).toBe(HEX);
  });

  it('rejects a value that is not a 24-character hex ObjectId', () => {
    expect(() => createUserId('')).toThrow(/24-character hexadecimal ObjectId/);
    expect(() => createUserId('   ')).toThrow(/24-character hexadecimal ObjectId/);
    expect(() => createUserId('user-123')).toThrow(/24-character hexadecimal ObjectId/);
  });
});

describe('generateUserId', () => {
  it('generates a unique 24-char hex id on every call', () => {
    const first = generateUserId();
    const second = generateUserId();

    expect(first).toMatch(/^[a-f0-9]{24}$/);
    expect(first).not.toBe(second);
  });
});
