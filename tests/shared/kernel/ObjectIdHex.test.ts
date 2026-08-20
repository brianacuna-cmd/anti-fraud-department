import { ObjectId } from 'mongodb';
import { generateObjectIdHex, isObjectIdHex } from '../../../src/shared/kernel/ObjectIdHex.js';

describe('isObjectIdHex', () => {
  it('accepts a 24-character hexadecimal string', () => {
    expect(isObjectIdHex('a'.repeat(24))).toBe(true);
    expect(isObjectIdHex('ABCDEF0123456789abcdef01')).toBe(true);
  });

  it('rejects anything that is not 24 hex characters', () => {
    expect(isObjectIdHex('')).toBe(false);
    expect(isObjectIdHex('user-1')).toBe(false);
    expect(isObjectIdHex('a'.repeat(23))).toBe(false);
    expect(isObjectIdHex('g'.repeat(24))).toBe(false);
  });
});

describe('generateObjectIdHex', () => {
  it('returns a unique 24-char hex string that MongoDB accepts as ObjectId', () => {
    const first = generateObjectIdHex();
    const second = generateObjectIdHex();

    expect(first).toMatch(/^[a-f0-9]{24}$/);
    expect(first).not.toBe(second);
    expect(new ObjectId(first)).toBeInstanceOf(ObjectId);
    expect(new ObjectId(first).toString()).toBe(first);
  });
});
