import type { EntryType } from '../model/value-objects/EntryType.js';
import type { WatchlistEntryId } from '../model/value-objects/WatchlistEntryId.js';
import type { WatchlistId } from '../model/value-objects/WatchlistId.js';

/**
 * Domain-shaped candidate returned by the blocking layer. Adapters MUST
 * return this type, never a raw Mongo document or cursor (spec RF-2).
 */
export interface WatchlistCandidate {
  readonly id: WatchlistEntryId;
  readonly watchlistId: WatchlistId;
  readonly nombre: string;
  readonly documento: string | null;
  readonly walletAddress: string | null;
  readonly nivelRiesgo: string | null;
  readonly nombreNormalizado: string;
  readonly phoneticKeys: readonly string[];
  readonly pais: string | null;
}

export interface WatchlistCandidateQuery {
  readonly organizationId: string;
  readonly normalizedName?: string;
  readonly phoneticKeys?: readonly string[];
  readonly documento?: string;
  readonly walletAddress?: string;
  readonly entryType: EntryType;
  readonly limit: number;
}

/**
 * Blocking-layer port (spec RF-2, RF-5). Implementations MUST filter by
 * `organizationId` and MUST exclude `estado != "ACTIVE"` and soft-deleted
 * (`deleted_at != null`) entries at query time, not post-hoc. Two adapters
 * implement this port identically: `MongoIndexWatchlistCandidateRepository`
 * (CI/test, mongodb-memory-server-compatible) and
 * `MongoAtlasWatchlistCandidateRepository` (staging/prod `$search`, not
 * CI-testable). DI selection lands in a later slice.
 */
export interface WatchlistCandidateRepository {
  findCandidates(query: WatchlistCandidateQuery): Promise<WatchlistCandidate[]>;
}
