import { createMatchScore } from '../../../../../src/modules/screening/domain/model/value-objects/MatchScore.js';
import { ScreeningError } from '../../../../../src/modules/screening/domain/errors/ScreeningError.js';

describe('createMatchScore', () => {
  it.each([0, 50, 100])('accepts %d', (value) => {
    expect(createMatchScore(value)).toBe(value);
  });

  it('rejects a negative value instead of clamping to 0', () => {
    expect(() => createMatchScore(-1)).toThrow(ScreeningError);
  });

  it('rejects a value above 100 instead of clamping to 100', () => {
    expect(() => createMatchScore(101)).toThrow(ScreeningError);
  });

  it('rejects a non-integer value', () => {
    expect(() => createMatchScore(50.5)).toThrow(ScreeningError);
  });
});
