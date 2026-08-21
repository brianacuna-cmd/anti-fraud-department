/**
 * Encodes a normalized name token into its phonetic keys (e.g. Double
 * Metaphone). Implementations live in infrastructure — the domain only
 * depends on this shape so `MatchingStrategySelector` stays pure and
 * testable without a real phonetic library.
 */
export interface PhoneticEncoder {
  encode(token: string): string[];
}
