import { normalizeName } from '../../../../src/modules/screening/domain/ports/NameNormalizer.js';

describe('normalizeName', () => {
  it('lowercases the input', () => {
    expect(normalizeName('JOHN DOE')).toBe('john doe');
  });

  it('strips accents via NFD normalization', () => {
    expect(normalizeName('José Ñañez')).toBe('jose nanez');
  });

  it('strips punctuation', () => {
    expect(normalizeName("O'Brien, Jr.")).toBe('obrien jr');
  });

  it('collapses repeated whitespace between tokens', () => {
    expect(normalizeName('John   Doe')).toBe('john doe');
  });

  it('trims leading/trailing whitespace', () => {
    expect(normalizeName('  John Doe  ')).toBe('john doe');
  });

  it('is idempotent (usable at write and read paths identically)', () => {
    const once = normalizeName('José  O\'Brien');
    expect(normalizeName(once)).toBe(once);
  });

  it('returns an empty string for empty input', () => {
    expect(normalizeName('')).toBe('');
  });
});
