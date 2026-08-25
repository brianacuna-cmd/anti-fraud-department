import type { Watchlist } from '../../../src/modules/screening/domain/model/aggregates/Watchlist.js';
import type { WatchlistId } from '../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import type {
  WatchlistListQuery,
  WatchlistListResult,
  WatchlistRepository,
} from '../../../src/modules/screening/domain/ports/WatchlistRepository.js';

/** In-memory `WatchlistRepository` fake for domain/application-level tests. */
export class InMemoryWatchlistRepository implements WatchlistRepository {
  private readonly byId = new Map<string, Watchlist>();

  async create(watchlist: Watchlist): Promise<void> {
    this.byId.set(String(watchlist.id), watchlist);
  }

  async save(watchlist: Watchlist): Promise<void> {
    this.byId.set(String(watchlist.id), watchlist);
  }

  async findById(id: WatchlistId): Promise<Watchlist | null> {
    return this.byId.get(String(id)) ?? null;
  }

  async findByNameForOrg(organizationId: string, name: string): Promise<Watchlist | null> {
    return (
      [...this.byId.values()].find(
        (watchlist) =>
          watchlist.organizationId === organizationId && watchlist.name === name && watchlist.deletedAt === null,
      ) ?? null
    );
  }

  async list(query: WatchlistListQuery): Promise<WatchlistListResult> {
    const filtered = [...this.byId.values()]
      .filter((watchlist) => watchlist.organizationId === query.organizationId)
      .filter((watchlist) => query.status === undefined || query.status.length === 0 || query.status.includes(watchlist.status))
      .filter((watchlist) => query.type === undefined || query.type.length === 0 || query.type.includes(watchlist.type))
      .sort((a, b) => (b.createdAt as string).localeCompare(a.createdAt as string));
    return {
      items: filtered.slice(query.offset, query.offset + query.limit),
      total: filtered.length,
    };
  }

  all(): Watchlist[] {
    return [...this.byId.values()];
  }
}
