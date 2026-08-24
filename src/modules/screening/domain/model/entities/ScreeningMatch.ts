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
  readonly name: string;
  readonly document: string | null;
  readonly riskLevel: string | null;
  readonly matchField: MatchField;
  readonly algorithm: string;
}

export interface CreateScreeningMatchInput {
  readonly entryId: WatchlistEntryId;
  readonly watchlistId: WatchlistId;
  readonly name: string;
  readonly document?: string | null;
  readonly riskLevel?: string | null;
  readonly matchField: MatchField;
  readonly algorithm: string;
}

export function createScreeningMatch(input: CreateScreeningMatchInput): ScreeningMatch {
  if (input.name.trim().length === 0) {
    throw invariantViolation('ScreeningMatch name must be a non-empty string', { input });
  }
  if (input.algorithm.trim().length === 0) {
    throw invariantViolation('ScreeningMatch algorithm must be a non-empty string', { input });
  }
  return {
    entryId: input.entryId,
    watchlistId: input.watchlistId,
    name: input.name,
    document: input.document ?? null,
    riskLevel: input.riskLevel ?? null,
    matchField: input.matchField,
    algorithm: input.algorithm,
  };
}
