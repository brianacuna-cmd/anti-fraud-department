import {
  selectStrategy,
  scoreMatch,
  DEFAULT_MATCHING_WEIGHTS,
} from '../../../../src/modules/screening/domain/services/MatchingStrategySelector.js';
import type { PhoneticEncoder } from '../../../../src/modules/screening/domain/ports/PhoneticEncoder.js';
import type { SimilarityCalculator } from '../../../../src/modules/screening/domain/ports/SimilarityCalculator.js';

function firstLetterEncoder(): PhoneticEncoder {
  return {
    encode: jest.fn((token: string) => (token.length > 0 ? [token[0].toUpperCase()] : [])),
  };
}

function fixedSimilarityCalculator(jaroWinklerValue: number, levenshteinValue = 0): SimilarityCalculator {
  return {
    jaroWinkler: jest.fn(() => jaroWinklerValue),
    levenshtein: jest.fn(() => levenshteinValue),
  };
}

describe('selectStrategy', () => {
  it('selects PHONETIC_SIMILARITY for NAME', () => {
    expect(selectStrategy('NAME')).toBe('PHONETIC_SIMILARITY');
  });

  it('selects EXACT_LEVENSHTEIN for DOCUMENTO', () => {
    expect(selectStrategy('DOCUMENTO')).toBe('EXACT_LEVENSHTEIN');
  });

  it('selects EXACT_LEVENSHTEIN for WALLET (no phonetics)', () => {
    expect(selectStrategy('WALLET')).toBe('EXACT_LEVENSHTEIN');
  });
});

describe('scoreMatch — NAME', () => {
  it('combines phonetic agreement (0.4) and jaro-winkler token-sort (0.6) per DEFAULT_MATCHING_WEIGHTS', () => {
    const phoneticEncoder = firstLetterEncoder();
    const similarityCalculator = fixedSimilarityCalculator(0.8);

    const score = scoreMatch('NAME', 'John Smith', 'Jon Smith', {
      phoneticEncoder,
      similarityCalculator,
    });

    expect(DEFAULT_MATCHING_WEIGHTS).toEqual({ phoneticWeight: 0.4, similarityWeight: 0.6 });
    // agreement = 1 (both {J,S}), jaroWinkler = 0.8 -> round(100*(0.4*1+0.6*0.8)) = 88
    expect(score).toBe(88);
  });

  it('yields 0 phonetic agreement when no phonetic keys overlap', () => {
    const phoneticEncoder: PhoneticEncoder = { encode: jest.fn(() => []) };
    const similarityCalculator = fixedSimilarityCalculator(0.5);

    const score = scoreMatch('NAME', 'Alpha', 'Beta', { phoneticEncoder, similarityCalculator });

    // agreement = 0 -> round(100*(0.4*0+0.6*0.5)) = 30
    expect(score).toBe(30);
  });
});

describe('scoreMatch — DOCUMENTO', () => {
  it('scores 100 on an exact match without calling the similarity calculator', () => {
    const similarityCalculator = fixedSimilarityCalculator(0, 0);
    const phoneticEncoder = firstLetterEncoder();

    const score = scoreMatch('DOCUMENTO', '12345678', '12345678', { phoneticEncoder, similarityCalculator });

    expect(score).toBe(100);
    expect(similarityCalculator.levenshtein).not.toHaveBeenCalled();
  });

  it('scores proportionally to levenshtein distance when within tolerance (<=2)', () => {
    const similarityCalculator = fixedSimilarityCalculator(0, 1);
    const phoneticEncoder = firstLetterEncoder();

    const score = scoreMatch('DOCUMENTO', '12345678', '12345679', { phoneticEncoder, similarityCalculator });

    // round(100*(1 - 1/8)) = 88
    expect(score).toBe(88);
  });

  it('scores 0 when levenshtein distance exceeds tolerance (>2)', () => {
    const similarityCalculator = fixedSimilarityCalculator(0, 3);
    const phoneticEncoder = firstLetterEncoder();

    const score = scoreMatch('DOCUMENTO', '12345678', '99999999', { phoneticEncoder, similarityCalculator });

    expect(score).toBe(0);
  });
});

describe('scoreMatch — WALLET', () => {
  it('never calls the phonetic encoder', () => {
    const similarityCalculator = fixedSimilarityCalculator(0, 0);
    const phoneticEncoder = firstLetterEncoder();

    scoreMatch('WALLET', '0xabc123', '0xabc123', { phoneticEncoder, similarityCalculator });

    expect(phoneticEncoder.encode).not.toHaveBeenCalled();
  });

  it('scores 100 on an exact wallet match', () => {
    const similarityCalculator = fixedSimilarityCalculator(0, 0);
    const phoneticEncoder = firstLetterEncoder();

    const score = scoreMatch('WALLET', '0xabc123', '0xabc123', { phoneticEncoder, similarityCalculator });

    expect(score).toBe(100);
  });
});
