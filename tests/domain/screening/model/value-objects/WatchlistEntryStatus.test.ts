import {
  createWatchlistEntryStatus,
  isWatchlistEntryStatus,
} from '../../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryStatus.js';
import { ScreeningError } from '../../../../../src/modules/screening/domain/errors/ScreeningError.js';

describe('createWatchlistEntryStatus', () => {
  it.each(['ACTIVE', 'INACTIVE', 'REMOVED'])('accepts %s', (value) => {
    expect(createWatchlistEntryStatus(value)).toBe(value);
  });

  it('rejects an unknown status', () => {
    expect(() => createWatchlistEntryStatus('DELETED')).toThrow(ScreeningError);
  });
});

describe('isWatchlistEntryStatus', () => {
  it('returns true for valid values', () => {
    expect(isWatchlistEntryStatus('ACTIVE')).toBe(true);
    expect(isWatchlistEntryStatus('REMOVED')).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isWatchlistEntryStatus('PENDING')).toBe(false);
    expect(isWatchlistEntryStatus(null)).toBe(false);
  });
});
