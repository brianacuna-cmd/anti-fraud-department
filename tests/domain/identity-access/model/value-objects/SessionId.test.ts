import {
  createSessionId,
  generateSessionId,
} from '../../../../../src/modules/identity-access/domain/model/value-objects/SessionId.js';

const HEX = 'a'.repeat(24);

describe('createSessionId', () => {
  it('accepts a 24-character hexadecimal ObjectId', () => {
    expect(createSessionId(HEX)).toBe(HEX);
  });

  it('rejects a value that is not a 24-character hex ObjectId', () => {
    expect(() => createSessionId('')).toThrow(/24-character hexadecimal ObjectId/);
    expect(() => createSessionId('not-an-objectid')).toThrow(/24-character hexadecimal ObjectId/);
  });
});

describe('generateSessionId', () => {
  it('generates a unique 24-char hex id on every call', () => {
    const first = generateSessionId();
    const second = generateSessionId();

    expect(first).toMatch(/^[a-f0-9]{24}$/);
    expect(first).not.toBe(second);
  });
});
