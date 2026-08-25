import { createWatchlistType, isWatchlistType } from '../../../../../src/modules/screening/domain/model/value-objects/WatchlistType.js';
import { ScreeningError } from '../../../../../src/modules/screening/domain/errors/ScreeningError.js';

describe('createWatchlistType', () => {
  it.each(['BLACKLIST', 'WHITELIST'])('accepts %s', (value) => {
    expect(createWatchlistType(value)).toBe(value);
  });

  it('rejects an unknown type', () => {
    expect(() => createWatchlistType('GREYLIST')).toThrow(ScreeningError);
  });
});

describe('isWatchlistType', () => {
  it('returns true for valid values', () => {
    expect(isWatchlistType('BLACKLIST')).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isWatchlistType('GREYLIST')).toBe(false);
    expect(isWatchlistType(42)).toBe(false);
  });
});
