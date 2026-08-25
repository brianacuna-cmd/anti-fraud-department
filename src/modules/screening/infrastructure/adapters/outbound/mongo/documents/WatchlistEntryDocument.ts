/**
 * Mongo document shape for `watchlist_entries`. `_id` and `watchlist_id`
 * are native BSON `ObjectId`. `normalized_name` and `phonetic_keys` are
 * precomputed at write time (`IndexWatchlistEntry`) using the same shared
 * `NameNormalizer`/`PhoneticEncoder` the read path uses, per the spec's
 * single-normalizer invariant.
 */
import type { ObjectId } from 'mongodb';

export interface WatchlistEntryDocument {
  readonly _id: ObjectId;
  readonly watchlist_id: ObjectId;
  readonly organization_id: ObjectId;
  readonly entry_type: string;
  readonly name: string;
  readonly normalized_name: string;
  readonly phonetic_keys: readonly string[];
  readonly document: string | null;
  readonly wallet_address: string | null;
  readonly risk_level: string | null;
  readonly country: string | null;
  readonly status: string;
  readonly deleted_at: Date | null;
  /** Additive (Slice B, RNF-5): absent on pre-B documents; write-path always sets them. */
  readonly created_at?: Date;
  readonly updated_at?: Date;
}
