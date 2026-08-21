import {
  createWatchlistEntryId,
  generateWatchlistEntryId,
} from '../../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { ScreeningError } from '../../../../../src/modules/screening/domain/errors/ScreeningError.js';

describe('WatchlistEntryId', () => {
  it('accepts a 24-char hex string', () => {
    const raw = '507f1f77bcf86cd799439011';
    expect(createWatchlistEntryId(raw)).toBe(raw);
  });

  it('rejects a non-hex value', () => {
    expect(() => createWatchlistEntryId('not-an-id')).toThrow(ScreeningError);
  });

  it('generates a fresh valid id', () => {
    const id = generateWatchlistEntryId();
    expect(createWatchlistEntryId(id)).toBe(id);
  });
});
