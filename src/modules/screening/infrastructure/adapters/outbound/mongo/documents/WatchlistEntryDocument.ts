/**
 * Mongo document shape for `watchlist_entries`. `_id` and `watchlist_id`
 * are native BSON `ObjectId`. `nombre_normalizado` and `phonetic_keys` are
 * precomputed at write time (`IndexWatchlistEntry`, a later slice) using
 * the same shared `NameNormalizer`/`PhoneticEncoder` the read path uses,
 * per the spec's single-normalizer invariant.
 */
import type { ObjectId } from 'mongodb';

export interface WatchlistEntryDocument {
  readonly _id: ObjectId;
  readonly watchlist_id: ObjectId;
  readonly organization_id: ObjectId;
  readonly tipo_entrada: string;
  readonly nombre: string;
  readonly nombre_normalizado: string;
  readonly phonetic_keys: readonly string[];
  readonly documento: string | null;
  readonly wallet_address: string | null;
  readonly nivel_riesgo: string | null;
  readonly pais: string | null;
  readonly estado: string;
  readonly deleted_at: Date | null;
}
