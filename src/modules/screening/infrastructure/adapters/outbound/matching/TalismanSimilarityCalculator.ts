import jaroWinkler from 'talisman/metrics/jaro-winkler.js';
import levenshtein from 'talisman/metrics/levenshtein.js';
import type { SimilarityCalculator } from '../../../../domain/ports/SimilarityCalculator.js';

const WHITESPACE_PATTERN = /\s+/;

/**
 * `talisman` similarity metrics adapter for the `SimilarityCalculator`
 * port. The only place in the screening module allowed to import
 * `talisman` metrics.
 *
 * `jaroWinkler` is token-sort aware: each side's whitespace-delimited
 * tokens are sorted alphabetically before scoring, so "john smith" and
 * "smith john" compare as near-identical rather than being penalized for
 * word order (per RF-1's NAME strategy requirement).
 */
export class TalismanSimilarityCalculator implements SimilarityCalculator {
  jaroWinkler(a: string, b: string): number {
    return jaroWinkler(tokenSort(a), tokenSort(b));
  }

  levenshtein(a: string, b: string): number {
    return levenshtein(a, b);
  }
}

/**
 * Canonical token order, so word order stops mattering before `jaroWinkler`
 * sees the two names. The comparator is explicit for the same reason as in
 * `MatchingStrategySelector`: the default `sort()` orders by UTF-16 code unit
 * and files every accented letter after `Z`.
 */
function tokenSort(value: string): string {
  const tokens = value.split(WHITESPACE_PATTERN).filter((token) => token.length > 0);
  return tokens.sort((a, b) => a.localeCompare(b)).join(' ');
}
