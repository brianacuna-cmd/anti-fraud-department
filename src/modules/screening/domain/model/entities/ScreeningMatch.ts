import { invariantViolation } from '../../errors/ScreeningError.js';
import type { WatchlistEntryId } from '../value-objects/WatchlistEntryId.js';
import type { WatchlistId } from '../value-objects/WatchlistId.js';
import type { MatchField } from '../value-objects/MatchField.js';

/**
 * Embedded snapshot of the watchlist entry an `AmlAlert` matched against, as
 * it existed at match time (spec RF-3: "matched_entry ... embedded snapshot
 * ... MUST include match_field ... and algorithm"). Not an aggregate — a
 * plain immutable value carried on `AmlAlert`, never persisted on its own.
 */
export interface ScreeningMatch {
  readonly entryId: WatchlistEntryId;
  readonly watchlistId: WatchlistId;
  readonly nombre: string;
  readonly documento: string | null;
  readonly nivelRiesgo: string | null;
  readonly matchField: MatchField;
  readonly algorithm: string;
}

export interface CreateScreeningMatchInput {
  readonly entryId: WatchlistEntryId;
  readonly watchlistId: WatchlistId;
  readonly nombre: string;
  readonly documento?: string | null;
  readonly nivelRiesgo?: string | null;
  readonly matchField: MatchField;
  readonly algorithm: string;
}

export function createScreeningMatch(input: CreateScreeningMatchInput): ScreeningMatch {
  if (input.nombre.trim().length === 0) {
    throw invariantViolation('ScreeningMatch nombre must be a non-empty string', { input });
  }
  if (input.algorithm.trim().length === 0) {
    throw invariantViolation('ScreeningMatch algorithm must be a non-empty string', { input });
  }
  return {
    entryId: input.entryId,
    watchlistId: input.watchlistId,
    nombre: input.nombre,
    documento: input.documento ?? null,
    nivelRiesgo: input.nivelRiesgo ?? null,
    matchField: input.matchField,
    algorithm: input.algorithm,
  };
}
