import type { Watchlist } from '../../../../../domain/model/aggregates/Watchlist.js';
import type { WatchlistEntry } from '../../../../../domain/model/aggregates/WatchlistEntry.js';
import type { Instant } from '../../../../../../../shared/time/Instant.js';

export interface WatchlistResponseDto {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly source: string;
  readonly type: string;
  readonly description: string | null;
  readonly status: string;
  readonly deletedAt: Instant | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export function toWatchlistResponse(watchlist: Watchlist): WatchlistResponseDto {
  return {
    id: String(watchlist.id),
    organizationId: watchlist.organizationId,
    name: watchlist.name,
    source: watchlist.source,
    type: watchlist.type,
    description: watchlist.description,
    status: watchlist.status,
    deletedAt: watchlist.deletedAt,
    createdAt: watchlist.createdAt,
    updatedAt: watchlist.updatedAt,
  };
}

export interface WatchlistEntryResponseDto {
  readonly id: string;
  readonly watchlistId: string;
  readonly organizationId: string;
  readonly entryType: string;
  readonly name: string;
  readonly document: string | null;
  readonly walletAddress: string | null;
  readonly riskLevel: string | null;
  readonly country: string | null;
  readonly status: string;
  readonly deletedAt: Instant | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export function toWatchlistEntryResponse(entry: WatchlistEntry): WatchlistEntryResponseDto {
  return {
    id: String(entry.id),
    watchlistId: String(entry.watchlistId),
    organizationId: entry.organizationId,
    entryType: entry.entryType,
    name: entry.name,
    document: entry.document,
    walletAddress: entry.walletAddress,
    riskLevel: entry.riskLevel,
    country: entry.country,
    status: entry.status,
    deletedAt: entry.deletedAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}
