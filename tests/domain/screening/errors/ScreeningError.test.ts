import { watchlistEntryNotFound } from '../../../../src/modules/screening/domain/errors/ScreeningError.js';
import { screeningErrorStatus } from '../../../../src/modules/screening/infrastructure/adapters/inbound/http/errorStatus.js';
import type { ScreeningErrorCode } from '../../../../src/modules/screening/domain/errors/ScreeningErrorCode.js';

/**
 * Task 24: WATCHLIST_ENTRY_NOT_FOUND error code + HTTP mapping.
 */
describe('ScreeningError — WatchlistEntry errors', () => {
  it('watchlistEntryNotFound returns ScreeningError with WATCHLIST_ENTRY_NOT_FOUND code', () => {
    const err = watchlistEntryNotFound('entry-abc');
    expect(err.code).toBe('WATCHLIST_ENTRY_NOT_FOUND');
    expect(err.message).toContain('entry-abc');
  });

  it('screeningErrorStatus maps WATCHLIST_ENTRY_NOT_FOUND to 404', () => {
    const code: ScreeningErrorCode = 'WATCHLIST_ENTRY_NOT_FOUND';
    expect(screeningErrorStatus[code]).toBe(404);
  });
});
