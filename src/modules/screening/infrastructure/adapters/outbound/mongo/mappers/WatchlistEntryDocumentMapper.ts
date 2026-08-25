import { createWatchlistEntryId } from '../../../../../domain/model/value-objects/WatchlistEntryId.js';
import { createWatchlistId } from '../../../../../domain/model/value-objects/WatchlistId.js';
import type { WatchlistCandidate } from '../../../../../domain/ports/WatchlistCandidateRepository.js';
import type { WatchlistEntryDocument } from '../documents/WatchlistEntryDocument.js';

/** snake_case (Mongo) -> domain `WatchlistCandidate` (read path, never a cursor). */
export function toCandidate(entry: WatchlistEntryDocument): WatchlistCandidate {
  return {
    id: createWatchlistEntryId(entry._id.toString()),
    watchlistId: createWatchlistId(entry.watchlist_id.toString()),
    name: entry.name,
    document: entry.document,
    walletAddress: entry.wallet_address,
    riskLevel: entry.risk_level,
    normalizedName: entry.normalized_name,
    phoneticKeys: entry.phonetic_keys,
    country: entry.country,
  };
}
