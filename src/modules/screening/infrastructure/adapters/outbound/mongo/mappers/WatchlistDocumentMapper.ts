import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { Watchlist } from '../../../../../domain/model/aggregates/Watchlist.js';
import { createWatchlistId } from '../../../../../domain/model/value-objects/WatchlistId.js';
import { createWatchlistType } from '../../../../../domain/model/value-objects/WatchlistType.js';
import { createWatchlistStatus } from '../../../../../domain/model/value-objects/WatchlistStatus.js';
import type { WatchlistDocument } from '../documents/WatchlistDocument.js';

/** snake_case (Mongo) -> camelCase (domain). Instant fields are BSON `Date`. */
export function toDomain(document: WatchlistDocument): Watchlist {
  return Watchlist.rehydrate({
    id: createWatchlistId(document._id.toString()),
    organizationId: document.organization_id.toString(),
    name: document.name,
    source: document.source,
    type: createWatchlistType(document.type),
    description: document.description,
    status: createWatchlistStatus(document.status),
    deletedAt: document.deleted_at ? fromDate(document.deleted_at) : null,
    createdAt: fromDate(document.created_at),
    updatedAt: fromDate(document.updated_at),
  });
}

/** camelCase (domain) -> snake_case (Mongo). */
export function toDocument(watchlist: Watchlist): WatchlistDocument {
  return {
    _id: new ObjectId(watchlist.id),
    organization_id: new ObjectId(watchlist.organizationId),
    name: watchlist.name,
    source: watchlist.source,
    type: watchlist.type,
    description: watchlist.description,
    status: watchlist.status,
    deleted_at: watchlist.deletedAt ? toDate(watchlist.deletedAt) : null,
    created_at: toDate(watchlist.createdAt),
    updated_at: toDate(watchlist.updatedAt),
  };
}
