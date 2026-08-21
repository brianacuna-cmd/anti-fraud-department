import { createWatchlistEntryId } from '../../../../../domain/model/value-objects/WatchlistEntryId.js';
import { createWatchlistId } from '../../../../../domain/model/value-objects/WatchlistId.js';
import type { WatchlistCandidate } from '../../../../../domain/ports/WatchlistCandidateRepository.js';
import type { WatchlistEntryDocument } from '../documents/WatchlistEntryDocument.js';

/** snake_case (Mongo) -> domain `WatchlistCandidate` (read path, never a cursor). */
export function toCandidate(document: WatchlistEntryDocument): WatchlistCandidate {
  return {
    id: createWatchlistEntryId(document._id.toString()),
    watchlistId: createWatchlistId(document.watchlist_id.toString()),
    nombre: document.nombre,
    documento: document.documento,
    walletAddress: document.wallet_address,
    nivelRiesgo: document.nivel_riesgo,
    nombreNormalizado: document.nombre_normalizado,
    phoneticKeys: document.phonetic_keys,
    pais: document.pais,
  };
}
