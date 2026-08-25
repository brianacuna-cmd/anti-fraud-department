import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { WatchlistEntryListResult, WatchlistEntryRepository } from '../domain/ports/WatchlistEntryRepository.js';
import type { WatchlistRepository } from '../domain/ports/WatchlistRepository.js';
import type { WatchlistEntryStatus } from '../domain/model/value-objects/WatchlistEntryStatus.js';
import type { EntryType } from '../domain/model/value-objects/EntryType.js';
import type { RiskLevel } from '../domain/model/value-objects/RiskLevel.js';
import { createWatchlistId } from '../domain/model/value-objects/WatchlistId.js';
import { watchlistNotFound } from '../domain/errors/ScreeningError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface ListWatchlistEntriesInput {
  readonly auth: AuthContext;
  readonly watchlistId: string;
  readonly status?: readonly WatchlistEntryStatus[];
  readonly entryType?: readonly EntryType[];
  readonly riskLevel?: readonly RiskLevel[];
  readonly country?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface ListWatchlistEntriesDeps {
  readonly watchlistRepository: WatchlistRepository;
  readonly watchlistEntryRepository: WatchlistEntryRepository;
}

/**
 * RF-7: tenant-scoped, paginated, filterable watchlist entry listing.
 * Parent watchlist must exist and belong to the caller's org (404 otherwise).
 */
export function createListWatchlistEntriesUseCase(deps: ListWatchlistEntriesDeps) {
  return async function listWatchlistEntries(input: ListWatchlistEntriesInput): Promise<WatchlistEntryListResult> {
    const organizationId = requireTenantContext(input.auth);
    const watchlistId = createWatchlistId(input.watchlistId);

    const watchlist = await deps.watchlistRepository.findById(watchlistId);
    if (watchlist === null || watchlist.organizationId !== organizationId) {
      throw watchlistNotFound(input.watchlistId);
    }

    return deps.watchlistEntryRepository.list({
      watchlistId,
      organizationId,
      status: input.status,
      entryType: input.entryType,
      riskLevel: input.riskLevel,
      country: input.country,
      limit: input.limit,
      offset: input.offset,
    });
  };
}
