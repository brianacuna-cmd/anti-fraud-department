import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { WatchlistListResult, WatchlistRepository } from '../domain/ports/WatchlistRepository.js';
import type { WatchlistType } from '../domain/model/value-objects/WatchlistType.js';
import type { WatchlistStatus } from '../domain/model/value-objects/WatchlistStatus.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface ListWatchlistsInput {
  readonly auth: AuthContext;
  readonly status?: readonly WatchlistStatus[];
  readonly type?: readonly WatchlistType[];
  readonly limit: number;
  readonly offset: number;
}

export interface ListWatchlistsDeps {
  readonly watchlistRepository: WatchlistRepository;
}

/** RF-2: tenant-scoped, paginated, filterable watchlist listing. */
export function createListWatchlistsUseCase(deps: ListWatchlistsDeps) {
  return async function listWatchlists(input: ListWatchlistsInput): Promise<WatchlistListResult> {
    const organizationId = requireTenantContext(input.auth);
    return deps.watchlistRepository.list({
      organizationId,
      status: input.status,
      type: input.type,
      limit: input.limit,
      offset: input.offset,
    });
  };
}
