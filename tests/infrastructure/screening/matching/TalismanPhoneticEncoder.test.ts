import { TalismanPhoneticEncoder } from '../../../../src/modules/screening/infrastructure/adapters/outbound/matching/TalismanPhoneticEncoder.js';

describe('TalismanPhoneticEncoder', () => {
  const encoder = new TalismanPhoneticEncoder();

  it('encodes a token into its Double Metaphone keys', () => {
    const keys = encoder.encode('smith');
    expect(keys).toEqual(['SM0', 'XMT']);
  });

  it('dedupes identical primary/secondary keys into a single key', () => {
    const keys = encoder.encode('bob');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('returns an empty array for non-alphabetic input without throwing', () => {
    expect(() => encoder.encode('123')).not.toThrow();
    expect(encoder.encode('123')).toEqual([]);
  });

  it('returns an empty array for an empty string without throwing', () => {
    expect(() => encoder.encode('')).not.toThrow();
    expect(encoder.encode('')).toEqual([]);
  });
});
