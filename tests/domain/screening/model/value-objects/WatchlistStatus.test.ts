import { createWatchlistStatus, isWatchlistStatus } from '../../../../../src/modules/screening/domain/model/value-objects/WatchlistStatus.js';
import { ScreeningError } from '../../../../../src/modules/screening/domain/errors/ScreeningError.js';

describe('createWatchlistStatus', () => {
  it.each(['ACTIVE', 'INACTIVE'])('accepts %s', (value) => {
    expect(createWatchlistStatus(value)).toBe(value);
  });

  it('rejects an unknown status', () => {
    expect(() => createWatchlistStatus('SUSPENDED')).toThrow(ScreeningError);
  });
});

describe('isWatchlistStatus', () => {
  it('returns true for valid values', () => {
    expect(isWatchlistStatus('ACTIVE')).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isWatchlistStatus('SUSPENDED')).toBe(false);
    expect(isWatchlistStatus(null)).toBe(false);
  });
});
