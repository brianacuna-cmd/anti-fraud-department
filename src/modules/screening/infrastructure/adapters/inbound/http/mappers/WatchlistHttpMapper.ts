import type { Watchlist } from '../../../../../domain/model/aggregates/Watchlist.js';
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
