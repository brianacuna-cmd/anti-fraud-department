import type { Watchlist } from '../model/aggregates/Watchlist.js';
import type { WatchlistId } from '../model/value-objects/WatchlistId.js';
import type { WatchlistType } from '../model/value-objects/WatchlistType.js';
import type { WatchlistStatus } from '../model/value-objects/WatchlistStatus.js';
import type { Transaction } from './UnitOfWork.js';

export interface WatchlistListQuery {
  readonly organizationId: string;
  readonly status?: readonly WatchlistStatus[];
  readonly type?: readonly WatchlistType[];
  readonly limit: number;
  readonly offset: number;
}

export interface WatchlistListResult {
  readonly items: readonly Watchlist[];
  readonly total: number;
}

/** Outbound port for `Watchlist` persistence. */
export interface WatchlistRepository {
  create(watchlist: Watchlist, tx?: Transaction): Promise<void>;
  save(watchlist: Watchlist, tx?: Transaction): Promise<void>;
  findById(id: WatchlistId, tx?: Transaction): Promise<Watchlist | null>;
  /** Uniqueness pre-check (per-org name), excludes soft-deleted watchlists. */
  findByNameForOrg(organizationId: string, name: string, tx?: Transaction): Promise<Watchlist | null>;
  list(query: WatchlistListQuery, tx?: Transaction): Promise<WatchlistListResult>;
}
