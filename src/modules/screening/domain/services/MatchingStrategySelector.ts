import type { MatchField } from '../model/value-objects/MatchField.js';
import { createMatchScore, type MatchScore } from '../model/value-objects/MatchScore.js';
import type { PhoneticEncoder } from '../ports/PhoneticEncoder.js';
import type { SimilarityCalculator } from '../ports/SimilarityCalculator.js';
import { normalizeName } from '../ports/NameNormalizer.js';

export type MatchingStrategy = 'PHONETIC_SIMILARITY' | 'EXACT_LEVENSHTEIN';

/** Maximum edit distance still considered a plausible typo/typosquat match. */
const LEVENSHTEIN_TOLERANCE = 2;

/*
 * Two NAME words are the same word when they are this similar, or when they
 * share a phonetic key and are at least `TOKEN_PHONETIC_SIMILARITY_MIN` alike.
 *
 * Calibrated against the real encoder and similarity adapters (Talisman) on
 * transliteration pairs that MUST match — Muhammad/Mohammed 0.85,
 * Mohamed/Muhammad 0.80, Osama/Usama 0.87, Vladimir/Wladimir 0.92 (no shared
 * key) — and on pairs the customer rescreen wrongly alerted on: Tate/Tuito
 * 0.63, Trosclair/Truschalov 0.76, Aceitera/Astara 0.75. A phonetic key alone
 * is not enough: "tate" and "tuito" both encode to TT.
 */
export const TOKEN_SIMILARITY_MIN = 0.88;
export const TOKEN_PHONETIC_SIMILARITY_MIN = 0.8;

/**
 * Ceiling for a name whose shorter side is not fully matched. Just below the
 * default alert threshold (50): sharing a first name — "Alejandro FLORES
 * CACHO" matched 203 different customers — is not a name match.
 */
export const PARTIAL_NAME_MAX_SCORE = 49;

/**
 * NAME confidence = `wordSimilarity` × how alike the paired words are +
 * `lengthRatio` × how much of the longer name the pairing accounts for.
 */
export const NAME_SCORE_WEIGHTS = { wordSimilarity: 0.5, lengthRatio: 0.5 } as const;

export interface MatchingStrategyDeps {
  readonly phoneticEncoder: PhoneticEncoder;
  readonly similarityCalculator: SimilarityCalculator;
}

/** Maps (field) -> the pure matching strategy descriptor, per design. */
export function selectStrategy(field: MatchField): MatchingStrategy {
  return field === 'NAME' ? 'PHONETIC_SIMILARITY' : 'EXACT_LEVENSHTEIN';
}

function tokenize(value: string): string[] {
  const normalized = normalizeName(value);
  return normalized.length === 0 ? [] : normalized.split(' ');
}

/** How alike two words are, or `null` when they are not the same word at all. */
function wordSimilarity(a: string, b: string, deps: MatchingStrategyDeps): number | null {
  if (a === b) return 1;
  const similarity = deps.similarityCalculator.jaroWinkler(a, b);
  if (similarity >= TOKEN_SIMILARITY_MIN) return similarity;
  if (similarity < TOKEN_PHONETIC_SIMILARITY_MIN) return null;
  const keys = new Set(deps.phoneticEncoder.encode(b));
  return deps.phoneticEncoder.encode(a).some((key) => keys.has(key)) ? similarity : null;
}

interface PairOption {
  readonly indexes: readonly number[];
  readonly similarity: number;
}

/**
 * Where `word` could pair in the longer name: a single unused word, or two
 * adjacent unused words written together.
 *
 * The join exists because the normalizer drops hyphens without a space, so
 * the list's «AL-ZAWAHIRI» arrives as one word ("alzawahiri") while a
 * customer's «al Zawahiri» arrives as two. Without it, a literal OFAC alias
 * lost a word and was capped at 49.
 */
function pairOptions(word: string, available: readonly (string | null)[], deps: MatchingStrategyDeps): PairOption[] {
  const singles = available.flatMap((token, index) => {
    if (token === null) return [];
    const similarity = wordSimilarity(word, token, deps);
    return similarity === null ? [] : [{ indexes: [index], similarity }];
  });
  const joined = available.flatMap((token, index) => {
    const next = available[index + 1];
    if (token === null || next === null || next === undefined) return [];
    const similarity = wordSimilarity(word, token + next, deps);
    return similarity === null ? [] : [{ indexes: [index, index + 1], similarity }];
  });
  return [...singles, ...joined];
}

/**
 * Pairs each word of the shorter name with its most similar unused word (or
 * adjacent pair) of the longer one. Returns the similarity of every pair — 0
 * when a word found no partner — and how many words of the longer name the
 * pairing used. Each word of the longer name is used at most once: "Juan
 * Juan" does not match "Juan Pérez" twice over.
 */
function pairWords(
  shorter: readonly string[],
  longer: readonly string[],
  deps: MatchingStrategyDeps,
): { similarities: number[]; used: number } {
  const available: (string | null)[] = [...longer];
  const similarities = shorter.map((word) => {
    const best = pairOptions(word, available, deps).reduce<PairOption | null>(
      (top, option) => (top === null || option.similarity > top.similarity ? option : top),
      null,
    );
    if (best === null) return 0;
    best.indexes.forEach((index) => {
      available[index] = null;
    });
    return best.similarity;
  });
  return { similarities, used: available.filter((token) => token === null).length };
}

/**
 * NAME confidence, compared word by word.
 *
 * The previous formula compared the two names as whole strings after sorting
 * their words alphabetically. A transliteration that changes a word's first
 * letter reorders the string — "muammar qaddafi" vs "gaddafi muammar" — and
 * the similarity collapsed: Qaddafi/Gaddafi scored 73, below the 85 an
 * official-list match needs. Pairing words first keeps the comparison aligned
 * whatever the spelling.
 *
 * Two structural rules keep common names from matching each other (the old
 * formula flagged 78% of customers against the official lists):
 *  - Every word of the shorter name must pair with a word of the other name;
 *    otherwise the score is capped at `PARTIAL_NAME_MAX_SCORE`.
 *  - When either name is a single word, only exact equality (normalized)
 *    counts. At the word level "rfc"/"rvc" (0.80) and "bryant"/"barents"
 *    (0.80) are indistinguishable from "mohamed"/"muhammad" (0.80); what
 *    separates the noise is that nothing else confirmed it. Known cost: a
 *    one-word customer "Rosneft" no longer matches "ROSNEFT OIL COMPANY".
 */
function scoreNameMatch(
  subjectName: string,
  candidateName: string,
  deps: MatchingStrategyDeps,
): MatchScore {
  const subjectTokens = tokenize(subjectName);
  const candidateTokens = tokenize(candidateName);
  if (subjectTokens.length === 0 || candidateTokens.length === 0) {
    return createMatchScore(0);
  }
  if (subjectTokens.length === 1 || candidateTokens.length === 1) {
    // Equal only if BOTH are that one word; with a single word order cannot matter.
    return createMatchScore(subjectTokens.join(' ') === candidateTokens.join(' ') ? 100 : 0);
  }

  const [shorter, longer] =
    subjectTokens.length <= candidateTokens.length ? [subjectTokens, candidateTokens] : [candidateTokens, subjectTokens];
  const { similarities, used } = pairWords(shorter, longer, deps);
  const words = similarities.reduce((sum, similarity) => sum + similarity, 0) / shorter.length;
  const lengthRatio = used / longer.length;
  const confidence = Math.round(
    100 * (NAME_SCORE_WEIGHTS.wordSimilarity * words + NAME_SCORE_WEIGHTS.lengthRatio * lengthRatio),
  );

  const fullyPaired = similarities.every((similarity) => similarity > 0);
  return createMatchScore(fullyPaired ? confidence : Math.min(confidence, PARTIAL_NAME_MAX_SCORE));
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
  const confidence = Math.round(100 * (1 - distance / maxLength));
  return createMatchScore(confidence);
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
