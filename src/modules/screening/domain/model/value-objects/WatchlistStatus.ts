import { invariantViolation } from '../../errors/ScreeningError.js';

export type WatchlistStatus = 'ACTIVE' | 'INACTIVE';

const VALID_WATCHLIST_STATUSES: ReadonlySet<string> = new Set<WatchlistStatus>(['ACTIVE', 'INACTIVE']);

export function isWatchlistStatus(value: unknown): value is WatchlistStatus {
  return typeof value === 'string' && VALID_WATCHLIST_STATUSES.has(value);
}

export function createWatchlistStatus(value: string): WatchlistStatus {
  if (!VALID_WATCHLIST_STATUSES.has(value)) {
    throw invariantViolation('WatchlistStatus must be one of ACTIVE, INACTIVE', { value });
  }
  return value as WatchlistStatus;
}
