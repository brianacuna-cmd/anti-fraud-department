import {
  createWatchlistId,
  generateWatchlistId,
} from '../../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { ScreeningError } from '../../../../../src/modules/screening/domain/errors/ScreeningError.js';

describe('WatchlistId', () => {
  it('accepts a 24-char hex string', () => {
    const raw = '507f1f77bcf86cd799439011';
    expect(createWatchlistId(raw)).toBe(raw);
  });

  it('rejects a non-hex value', () => {
    expect(() => createWatchlistId('bad')).toThrow(ScreeningError);
  });

  it('generates a fresh valid id', () => {
    const id = generateWatchlistId();
    expect(createWatchlistId(id)).toBe(id);
  });
});
