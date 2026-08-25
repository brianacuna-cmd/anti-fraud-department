import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Watchlist } from '../domain/model/aggregates/Watchlist.js';
import type { WatchlistRepository } from '../domain/ports/WatchlistRepository.js';
import { createWatchlistId } from '../domain/model/value-objects/WatchlistId.js';
import { watchlistNotFound } from '../domain/errors/ScreeningError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface GetWatchlistInput {
  readonly auth: AuthContext;
  readonly watchlistId: string;
}

export interface GetWatchlistDeps {
  readonly watchlistRepository: WatchlistRepository;
}

/**
 * RF-3/RNF-1: 404 for both a nonexistent id AND a same-shaped id belonging
 * to another org — the same error either way, so no cross-tenant existence
 * is leaked.
 */
export function createGetWatchlistUseCase(deps: GetWatchlistDeps) {
  return async function getWatchlist(input: GetWatchlistInput): Promise<Watchlist> {
    const organizationId = requireTenantContext(input.auth);
    const watchlistId = createWatchlistId(input.watchlistId);
    const watchlist = await deps.watchlistRepository.findById(watchlistId);
    if (watchlist === null || watchlist.organizationId !== organizationId) {
      throw watchlistNotFound(input.watchlistId);
    }
    return watchlist;
  };
}
