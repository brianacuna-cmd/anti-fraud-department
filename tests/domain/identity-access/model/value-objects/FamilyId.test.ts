import {
  createFamilyId,
  generateFamilyId,
} from '../../../../../src/modules/identity-access/domain/model/value-objects/FamilyId.js';

const HEX = 'a'.repeat(24);

describe('createFamilyId', () => {
  it('accepts a 24-character hexadecimal ObjectId', () => {
    expect(createFamilyId(HEX)).toBe(HEX);
  });

  it('rejects a value that is not a 24-character hex ObjectId', () => {
    expect(() => createFamilyId('')).toThrow(/24-character hexadecimal ObjectId/);
    expect(() => createFamilyId('not-an-objectid')).toThrow(/24-character hexadecimal ObjectId/);
  });
});

describe('generateFamilyId', () => {
  it('generates a unique 24-char hex id on every call', () => {
    const first = generateFamilyId();
    const second = generateFamilyId();

    expect(first).toMatch(/^[a-f0-9]{24}$/);
    expect(first).not.toBe(second);
  });
});
