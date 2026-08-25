import type { WatchlistEntryId } from '../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import type { WatchlistId } from '../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { generateWatchlistId } from '../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import type { Instant } from '../../../src/shared/time/Instant.js';
import type { Transaction } from '../../../src/modules/screening/domain/ports/UnitOfWork.js';
import type {
  WatchlistEntryIndexedFields,
  WatchlistEntryListQuery,
  WatchlistEntryListResult,
  WatchlistEntryRepository,
  WatchlistEntryToIndex,
} from '../../../src/modules/screening/domain/ports/WatchlistEntryRepository.js';
import type { WatchlistEntry } from '../../../src/modules/screening/domain/model/aggregates/WatchlistEntry.js';

interface FakeEntry {
  readonly id: WatchlistEntryId;
  readonly watchlistId: WatchlistId;
  name: string;
  status: string;
  deletedAt: Instant | null;
  aggregate?: WatchlistEntry;
}

/**
 * In-memory `WatchlistEntryRepository` fake shared by `IndexWatchlistEntry`,
 * `DeleteWatchlist` cascade, and the Slice B domain/application tests.
 * Implements the full port so no second fake is needed.
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

  async findToIndex(id: WatchlistEntryId, _tx?: Transaction): Promise<WatchlistEntryToIndex | null> {
    const entry = this.byId.get(String(id));
    return entry ? { id: entry.id, name: entry.name } : null;
  }

  async updateIndexedFields(id: WatchlistEntryId, fields: WatchlistEntryIndexedFields, _tx?: Transaction): Promise<void> {
    this.updates.set(String(id), fields);
  }

  async softDeleteAllByWatchlist(watchlistId: WatchlistId, now: Instant, _tx?: Transaction): Promise<void> {
    for (const entry of this.byId.values()) {
      if (entry.watchlistId === watchlistId && entry.status !== 'REMOVED') {
        entry.status = 'REMOVED';
        entry.deletedAt = now;
      }
    }
  }

  async create(entry: WatchlistEntry, _tx?: Transaction): Promise<void> {
    this.byId.set(String(entry.id), {
      id: entry.id,
      watchlistId: entry.watchlistId,
      name: entry.name,
      status: entry.status,
      deletedAt: entry.deletedAt,
      aggregate: entry,
    });
  }

  async save(entry: WatchlistEntry, _tx?: Transaction): Promise<void> {
    this.byId.set(String(entry.id), {
      id: entry.id,
      watchlistId: entry.watchlistId,
      name: entry.name,
      status: entry.status,
      deletedAt: entry.deletedAt,
      aggregate: entry,
    });
  }

  async findById(id: WatchlistEntryId, _tx?: Transaction): Promise<WatchlistEntry | null> {
    return this.byId.get(String(id))?.aggregate ?? null;
  }

  async list(query: WatchlistEntryListQuery, _tx?: Transaction): Promise<WatchlistEntryListResult> {
    const filtered = [...this.byId.values()]
      .filter((e) => e.watchlistId === query.watchlistId)
      .filter((e) => e.aggregate !== undefined && e.aggregate.organizationId === query.organizationId)
      .filter(
        (e) =>
          query.status === undefined || query.status.length === 0 || query.status.includes(e.status as 'ACTIVE' | 'INACTIVE' | 'REMOVED'),
      )
      .filter(
        (e) =>
          query.entryType === undefined ||
          query.entryType.length === 0 ||
          (e.aggregate !== undefined && query.entryType.includes(e.aggregate.entryType)),
      )
      .filter(
        (e) =>
          query.riskLevel === undefined ||
          query.riskLevel.length === 0 ||
          (e.aggregate !== undefined && e.aggregate.riskLevel !== null && query.riskLevel.includes(e.aggregate.riskLevel)),
      )
      .filter(
        (e) =>
          query.country === undefined ||
          (e.aggregate !== undefined && e.aggregate.country === query.country),
      )
      .sort((a, b) => {
        const ca = a.aggregate?.createdAt ?? '';
        const cb = b.aggregate?.createdAt ?? '';
        return (cb as string).localeCompare(ca as string);
      });

    return {
      items: filtered.slice(query.offset, query.offset + query.limit).map((e) => e.aggregate!),
      total: filtered.length,
    };
  }

  all(): FakeEntry[] {
    return [...this.byId.values()];
  }
}
