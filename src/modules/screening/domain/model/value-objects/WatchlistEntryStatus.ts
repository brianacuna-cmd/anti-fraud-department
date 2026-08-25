import { invariantViolation } from '../../errors/ScreeningError.js';

export type WatchlistEntryStatus = 'ACTIVE' | 'INACTIVE' | 'REMOVED';

const VALID_WATCHLIST_ENTRY_STATUSES: ReadonlySet<string> = new Set<WatchlistEntryStatus>([
  'ACTIVE',
  'INACTIVE',
  'REMOVED',
]);

export function isWatchlistEntryStatus(value: unknown): value is WatchlistEntryStatus {
  return typeof value === 'string' && VALID_WATCHLIST_ENTRY_STATUSES.has(value);
}

export function createWatchlistEntryStatus(value: string): WatchlistEntryStatus {
  if (!VALID_WATCHLIST_ENTRY_STATUSES.has(value)) {
    throw invariantViolation('WatchlistEntryStatus must be one of ACTIVE, INACTIVE, REMOVED', { value });
  }
  return value as WatchlistEntryStatus;
}
