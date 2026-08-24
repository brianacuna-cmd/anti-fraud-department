import type { MatchField } from '../model/value-objects/MatchField.js';
import { createMatchScore, type MatchScore } from '../model/value-objects/MatchScore.js';
import type { PhoneticEncoder } from '../ports/PhoneticEncoder.js';
import type { SimilarityCalculator } from '../ports/SimilarityCalculator.js';
import { normalizeName } from '../ports/NameNormalizer.js';

export type MatchingStrategy = 'PHONETIC_SIMILARITY' | 'EXACT_LEVENSHTEIN';

/** Maximum edit distance still considered a plausible typo/typosquat match. */
const LEVENSHTEIN_TOLERANCE = 2;

export interface MatchingWeights {
  readonly phoneticWeight: number;
  readonly similarityWeight: number;
}

/** Centralized weights for the NAME confianza formula — do not scatter magic numbers. */
export const DEFAULT_MATCHING_WEIGHTS: MatchingWeights = {
  phoneticWeight: 0.4,
  similarityWeight: 0.6,
};

export interface MatchingStrategyDeps {
  readonly phoneticEncoder: PhoneticEncoder;
  readonly similarityCalculator: SimilarityCalculator;
  readonly weights?: MatchingWeights;
}

/** Maps (field) -> the pure matching strategy descriptor, per design. */
export function selectStrategy(field: MatchField): MatchingStrategy {
  return field === 'NAME' ? 'PHONETIC_SIMILARITY' : 'EXACT_LEVENSHTEIN';
}

function tokenize(value: string): string[] {
  const normalized = normalizeName(value);
  return normalized.length === 0 ? [] : normalized.split(' ');
}

function phoneticAgreement(
  subjectTokens: readonly string[],
  candidateTokens: readonly string[],
  phoneticEncoder: PhoneticEncoder,
): number {
  const subjectKeys = new Set(subjectTokens.flatMap((token) => phoneticEncoder.encode(token)));
  const candidateKeys = new Set(candidateTokens.flatMap((token) => phoneticEncoder.encode(token)));
  const maxKeys = Math.max(subjectKeys.size, candidateKeys.size);
  if (maxKeys === 0) {
    return 0;
  }
  const sharedCount = [...subjectKeys].filter((key) => candidateKeys.has(key)).length;
  return sharedCount / maxKeys;
}

function tokenSort(tokens: readonly string[]): string {
  return [...tokens].sort().join(' ');
}

function scoreNameMatch(
  subjectName: string,
  candidateName: string,
  deps: MatchingStrategyDeps,
): MatchScore {
  const weights = deps.weights ?? DEFAULT_MATCHING_WEIGHTS;
  const subjectTokens = tokenize(subjectName);
  const candidateTokens = tokenize(candidateName);

  const agreement = phoneticAgreement(subjectTokens, candidateTokens, deps.phoneticEncoder);
  const similarity = deps.similarityCalculator.jaroWinkler(
    tokenSort(subjectTokens),
    tokenSort(candidateTokens),
  );

  const confianza = Math.round(100 * (weights.phoneticWeight * agreement + weights.similarityWeight * similarity));
  return createMatchScore(confianza);
}

function scoreExactLevenshteinMatch(
  subjectValue: string,
  candidateValue: string,
  similarityCalculator: SimilarityCalculator,
): MatchScore {
  if (subjectValue === candidateValue) {
    return createMatchScore(100);
  }
  const distance = similarityCalculator.levenshtein(subjectValue, candidateValue);
  if (distance > LEVENSHTEIN_TOLERANCE) {
    return createMatchScore(0);
  }
  const maxLength = Math.max(subjectValue.length, candidateValue.length, 1);
  const confianza = Math.round(100 * (1 - distance / maxLength));
  return createMatchScore(confianza);
}

/** Pure dispatch: scores a subject/candidate pair for the given match field. */
export function scoreMatch(
  field: MatchField,
  subjectValue: string,
  candidateValue: string,
  deps: MatchingStrategyDeps,
): MatchScore {
  if (selectStrategy(field) === 'PHONETIC_SIMILARITY') {
    return scoreNameMatch(subjectValue, candidateValue, deps);
  }
  return scoreExactLevenshteinMatch(subjectValue, candidateValue, deps.similarityCalculator);
}
