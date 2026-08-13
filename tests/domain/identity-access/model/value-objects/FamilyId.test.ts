import {
  createFamilyId,
  generateFamilyId,
} from '../../../../../src/modules/identity-access/domain/model/value-objects/FamilyId.js';

const OBJECT_ID_HEX_PATTERN = /^[0-9a-f]{24}$/i;

describe('createFamilyId', () => {
  it('accepts a non-empty string and returns it unchanged', () => {
    const id = createFamilyId('family-123');

    expect(id).toBe('family-123');
  });

  it('rejects an empty string as an invariant violation', () => {
    expect(() => createFamilyId('')).toThrow(/non-empty/);
  });

  it('rejects a whitespace-only string as an invariant violation', () => {
    expect(() => createFamilyId('   ')).toThrow(/non-empty/);
  });
});

describe('generateFamilyId', () => {
  it('generates a fresh id on every call', () => {
    const first = generateFamilyId();
    const second = generateFamilyId();

    expect(first).not.toBe(second);
  });

  it('returns a 24-char hex string the Mongo mapper stores as ObjectId', () => {
    const id = generateFamilyId();

    expect(id).toMatch(OBJECT_ID_HEX_PATTERN);
  });
});
