import type { WatchlistEntryId } from '../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import type { WatchlistId } from '../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { generateWatchlistId } from '../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import type { Instant } from '../../../src/shared/time/Instant.js';
import type {
  WatchlistEntryIndexedFields,
  WatchlistEntryRepository,
  WatchlistEntryToIndex,
} from '../../../src/modules/screening/domain/ports/WatchlistEntryRepository.js';

interface FakeEntry {
  readonly id: WatchlistEntryId;
  readonly watchlistId: WatchlistId;
  name: string;
  status: string;
  deletedAt: Instant | null;
}

/**
 * In-memory `WatchlistEntryRepository` fake, minimal — only what
 * `IndexWatchlistEntry` and the Slice A2 `DeleteWatchlist` cascade need
 * (design §9: full entry CRUD is Slice B).
 */
export class InMemoryWatchlistEntryRepository implements WatchlistEntryRepository {
  private readonly byId = new Map<string, FakeEntry>();
  readonly updates = new Map<string, WatchlistEntryIndexedFields>();

  seed(entry: {
    readonly id: WatchlistEntryId;
    readonly name: string;
    readonly watchlistId?: WatchlistId;
    readonly status?: string;
    readonly deletedAt?: Instant | null;
  }): void {
    this.byId.set(String(entry.id), {
      id: entry.id,
      watchlistId: entry.watchlistId ?? generateWatchlistId(),
      name: entry.name,
      status: entry.status ?? 'ACTIVE',
      deletedAt: entry.deletedAt ?? null,
    });
  }

  async findToIndex(id: WatchlistEntryId): Promise<WatchlistEntryToIndex | null> {
    const entry = this.byId.get(String(id));
    return entry ? { id: entry.id, name: entry.name } : null;
  }

  async updateIndexedFields(id: WatchlistEntryId, fields: WatchlistEntryIndexedFields): Promise<void> {
    this.updates.set(String(id), fields);
  }

  async softDeleteAllByWatchlist(watchlistId: WatchlistId, now: Instant): Promise<void> {
    for (const entry of this.byId.values()) {
      if (entry.watchlistId === watchlistId && entry.status !== 'REMOVED') {
        entry.status = 'REMOVED';
        entry.deletedAt = now;
      }
    }
  }

  all(): FakeEntry[] {
    return [...this.byId.values()];
  }
}
