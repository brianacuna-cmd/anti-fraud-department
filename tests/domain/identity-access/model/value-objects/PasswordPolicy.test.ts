import { assertPasswordPolicy, PASSWORD_MIN_LENGTH } from '../../../../../src/modules/identity-access/domain/model/value-objects/PasswordPolicy.js';

describe('assertPasswordPolicy', () => {
  it('accepts a password that meets every rule', () => {
    expect(() => assertPasswordPolicy('Str0ngPass')).not.toThrow();
  });

  it('rejects a trivially short password ("123") as a WEAK_PASSWORD domain error', () => {
    expect(() => assertPasswordPolicy('123')).toMatchObject; // guard below asserts the throw shape
    try {
      assertPasswordPolicy('123');
      fail('expected assertPasswordPolicy to throw');
    } catch (error) {
      expect(error).toMatchObject({ code: 'WEAK_PASSWORD' });
    }
  });

  it('rejects an empty password', () => {
    expect(() => assertPasswordPolicy('')).toThrow();
    try {
      assertPasswordPolicy('');
    } catch (error) {
      expect(error).toMatchObject({ code: 'WEAK_PASSWORD' });
    }
  });

  it(`rejects a password shorter than ${PASSWORD_MIN_LENGTH} characters`, () => {
    expect(() => assertPasswordPolicy('Ab1cdef')).toThrow(); // 7 chars
  });

  it('rejects a password with no uppercase letter', () => {
    expect(() => assertPasswordPolicy('str0ngpass')).toThrow();
  });

  it('rejects a password with no lowercase letter', () => {
    expect(() => assertPasswordPolicy('STR0NGPASS')).toThrow();
  });

  it('rejects a password with no digit', () => {
    expect(() => assertPasswordPolicy('StrongPass')).toThrow();
  });

  it('reports every failing rule in the error metadata (aggregated, not first-fail)', () => {
    try {
      assertPasswordPolicy('abc');
      fail('expected assertPasswordPolicy to throw');
    } catch (error) {
      const reasons = (error as { metadata: { reasons: string[] } }).metadata.reasons;
      expect(reasons).toEqual(expect.arrayContaining(['MIN_LENGTH', 'MISSING_UPPERCASE', 'MISSING_DIGIT']));
    }
  });
});
