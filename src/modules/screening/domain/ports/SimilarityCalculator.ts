/**
 * String similarity primitives used by `MatchingStrategySelector`.
 * Implementations live in infrastructure — the domain only depends on this
 * shape so the selector stays pure and testable without a real similarity
 * library.
 */
export interface SimilarityCalculator {
  jaroWinkler(a: string, b: string): number;
  levenshtein(a: string, b: string): number;
}
