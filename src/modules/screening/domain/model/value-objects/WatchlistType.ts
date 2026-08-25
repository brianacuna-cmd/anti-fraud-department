import { invariantViolation } from '../../errors/ScreeningError.js';

export type WatchlistType = 'BLACKLIST' | 'WHITELIST';

const VALID_WATCHLIST_TYPES: ReadonlySet<string> = new Set<WatchlistType>(['BLACKLIST', 'WHITELIST']);

export function isWatchlistType(value: unknown): value is WatchlistType {
  return typeof value === 'string' && VALID_WATCHLIST_TYPES.has(value);
}

export function createWatchlistType(value: string): WatchlistType {
  if (!VALID_WATCHLIST_TYPES.has(value)) {
    throw invariantViolation('WatchlistType must be one of BLACKLIST, WHITELIST', { value });
  }
  return value as WatchlistType;
}
