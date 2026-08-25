import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { WatchlistEntry } from '../../../../../domain/model/aggregates/WatchlistEntry.js';
import { createWatchlistEntryId } from '../../../../../domain/model/value-objects/WatchlistEntryId.js';
import { createWatchlistId } from '../../../../../domain/model/value-objects/WatchlistId.js';
import { createEntryType } from '../../../../../domain/model/value-objects/EntryType.js';
import { createWatchlistEntryStatus } from '../../../../../domain/model/value-objects/WatchlistEntryStatus.js';
import { isRiskLevel } from '../../../../../domain/model/value-objects/RiskLevel.js';
import type { WatchlistEntryDocument } from '../documents/WatchlistEntryDocument.js';

/**
 * Write-path mapper between `WatchlistEntry` aggregate and
 * `WatchlistEntryDocument`. The read-path `toCandidate` in
 * `WatchlistEntryDocumentMapper.ts` is left untouched (RNF-5).
 */
export function toDomain(document: WatchlistEntryDocument): WatchlistEntry {
  const createdAt = document.created_at
    ? fromDate(document.created_at)
    : fromDate(new Date(0));
  const updatedAt = document.updated_at
    ? fromDate(document.updated_at)
    : fromDate(new Date(0));

  return WatchlistEntry.rehydrate({
    id: createWatchlistEntryId(document._id.toString()),
    watchlistId: createWatchlistId(document.watchlist_id.toString()),
    organizationId: document.organization_id.toString(),
    entryType: createEntryType(document.entry_type),
    name: document.name,
    document: document.document,
    walletAddress: document.wallet_address,
    riskLevel: isRiskLevel(document.risk_level) ? document.risk_level : null,
    country: document.country,
    status: createWatchlistEntryStatus(document.status),
    deletedAt: document.deleted_at ? fromDate(document.deleted_at) : null,
    createdAt,
    updatedAt,
  });
}

/** camelCase (domain) -> snake_case (Mongo). Always sets created_at/updated_at. */
export function toDocument(entry: WatchlistEntry): WatchlistEntryDocument {
  return {
    _id: new ObjectId(entry.id),
    watchlist_id: new ObjectId(entry.watchlistId),
    organization_id: new ObjectId(entry.organizationId),
    entry_type: entry.entryType,
    name: entry.name,
    normalized_name: '',
    phonetic_keys: [],
    document: entry.document,
    wallet_address: entry.walletAddress,
    risk_level: entry.riskLevel,
    country: entry.country,
    status: entry.status,
    deleted_at: entry.deletedAt ? toDate(entry.deletedAt) : null,
    created_at: toDate(entry.createdAt),
    updated_at: toDate(entry.updatedAt),
  };
}
