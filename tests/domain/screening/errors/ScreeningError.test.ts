import {
  ScreeningError,
  invariantViolation,
} from '../../../../src/modules/screening/domain/errors/ScreeningError.js';

describe('ScreeningError factories', () => {
  it('invariantViolation produces INVARIANT_VIOLATION with the given message/metadata', () => {
    const error = invariantViolation('bad input', { value: 'x' });

    expect(error).toBeInstanceOf(ScreeningError);
    expect(error.code).toBe('INVARIANT_VIOLATION');
    expect(error.message).toBe('bad input');
    expect(error.metadata).toEqual({ value: 'x' });
  });

  it('defaults metadata to an empty object', () => {
    const error = invariantViolation('bad input');

    expect(error.metadata).toEqual({});
  });
});
