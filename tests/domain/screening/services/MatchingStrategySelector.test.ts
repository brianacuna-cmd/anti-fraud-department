import {
  selectStrategy,
  scoreMatch,
  NAME_SCORE_WEIGHTS,
  PARTIAL_NAME_MAX_SCORE,
} from '../../../../src/modules/screening/domain/services/MatchingStrategySelector.js';
import type { PhoneticEncoder } from '../../../../src/modules/screening/domain/ports/PhoneticEncoder.js';
import type { SimilarityCalculator } from '../../../../src/modules/screening/domain/ports/SimilarityCalculator.js';
import { TalismanPhoneticEncoder } from '../../../../src/modules/screening/infrastructure/adapters/outbound/matching/TalismanPhoneticEncoder.js';
import { TalismanSimilarityCalculator } from '../../../../src/modules/screening/infrastructure/adapters/outbound/matching/TalismanSimilarityCalculator.js';

function firstLetterEncoder(): PhoneticEncoder {
  return {
    encode: jest.fn((token: string) => (token.length > 0 ? [token[0].toUpperCase()] : [])),
  };
}

/** Each word is its own phonetic key: two words share a key only when they are equal. */
const identityEncoder: PhoneticEncoder = { encode: (token) => [token] };
const noKeysEncoder: PhoneticEncoder = { encode: () => [] };

function fixedSimilarityCalculator(jaroWinklerValue: number, levenshteinValue = 0): SimilarityCalculator {
  return {
    jaroWinkler: jest.fn(() => jaroWinklerValue),
    levenshtein: jest.fn(() => levenshteinValue),
  };
}

/** Single words only match themselves: isolates the pairing rule from spelling. */
const exactWordsOnly: SimilarityCalculator = {
  jaroWinkler: (a, b) => (a === b ? 1 : 0.2),
  levenshtein: () => 0,
};

describe('selectStrategy', () => {
  it('selects PHONETIC_SIMILARITY for NAME', () => {
    expect(selectStrategy('NAME')).toBe('PHONETIC_SIMILARITY');
  });

  it('selects EXACT_LEVENSHTEIN for DOCUMENT', () => {
    expect(selectStrategy('DOCUMENT')).toBe('EXACT_LEVENSHTEIN');
  });

  it('selects EXACT_LEVENSHTEIN for WALLET (no phonetics)', () => {
    expect(selectStrategy('WALLET')).toBe('EXACT_LEVENSHTEIN');
  });
});

describe('scoreMatch — NAME', () => {
  it('weighs how alike the paired words are and how much of the longer name they cover', () => {
    const score = scoreMatch('NAME', 'John Smith', 'Jon Smith', {
      phoneticEncoder: firstLetterEncoder(),
      similarityCalculator: fixedSimilarityCalculator(0.8),
    });

    expect(NAME_SCORE_WEIGHTS).toEqual({ wordSimilarity: 0.5, lengthRatio: 0.5 });
    // john~jon 0.8 (shared key), smith=smith 1 -> words 0.9; 2 of 2 words used -> ratio 1
    // round(100 * (0.5*0.9 + 0.5*1)) = 95
    expect(score).toBe(95);
  });

  it('pairs words alike enough even when they share no phonetic key', () => {
    const score = scoreMatch('NAME', 'Alpha One', 'Alfa Uno', {
      phoneticEncoder: noKeysEncoder,
      similarityCalculator: fixedSimilarityCalculator(0.9),
    });

    expect(score).toBe(95);
  });

  it('scores a shorter name inside a longer one lower the more words are left over', () => {
    const deps = { phoneticEncoder: identityEncoder, similarityCalculator: exactWordsOnly };

    // All of the shorter name found: words 1, ratio 3/4 and 2/4.
    expect(scoreMatch('NAME', 'Juan Carlos Perez', 'Juan Carlos Perez Gomez', deps)).toBe(88);
    expect(scoreMatch('NAME', 'Juan Perez', 'Juan Carlos Perez Gomez', deps)).toBe(75);
  });

  it('caps a name that shares only some of its words', () => {
    const deps = { phoneticEncoder: identityEncoder, similarityCalculator: exactWordsOnly };

    // One of three words: words 1/3, used 1/3 -> round(100 * (0.5/3 + 0.5/3)) = 33, already under the cap.
    expect(scoreMatch('NAME', 'Alejandro Flores Cacho', 'Alejandro Perez Mancilla', deps)).toBe(33);
    // Two of three would be 67 and clear the default alert threshold; the cap does not let it.
    expect(scoreMatch('NAME', 'Miguel Angel Diaz', 'Miguel Angel Contreras', deps)).toBe(PARTIAL_NAME_MAX_SCORE);
  });

  it('does not pair one word of the longer name twice', () => {
    const deps = { phoneticEncoder: identityEncoder, similarityCalculator: exactWordsOnly };

    expect(scoreMatch('NAME', 'Juan Juan', 'Juan Perez', deps)).toBe(PARTIAL_NAME_MAX_SCORE);
  });

  it('does not depend on word order', () => {
    const deps = { phoneticEncoder: identityEncoder, similarityCalculator: exactWordsOnly };

    expect(scoreMatch('NAME', 'Perez Juan', 'Juan Perez', deps)).toBe(100);
  });

  it('pairs a word with two adjacent words written together, as hyphenated names arrive', () => {
    const deps = { phoneticEncoder: identityEncoder, similarityCalculator: exactWordsOnly };

    // «BIN-LADEN» normalizes to "binladen"; «bin Laden» stays two words. Both words are used.
    expect(scoreMatch('NAME', 'Osama bin Laden', 'Osama BIN-LADEN', deps)).toBe(100);
    expect(scoreMatch('NAME', 'Aiman Muhammad Rabi al Zawahiri', 'Aiman Muhammad Rabi AL-ZAWAHIRI', deps)).toBe(100);
  });

  it('only accepts exact equality when either name is a single word', () => {
    const deps = { phoneticEncoder: firstLetterEncoder(), similarityCalculator: fixedSimilarityCalculator(0.95) };

    expect(scoreMatch('NAME', 'France', 'Frunze', deps)).toBe(0);
    expect(scoreMatch('NAME', 'France', 'ORT FRANCE', deps)).toBe(0);
    expect(scoreMatch('NAME', 'Rosneft', 'ROSNEFT', deps)).toBe(100);
    expect(scoreMatch('NAME', 'Pérez', 'PEREZ', deps)).toBe(100);
  });
});

/*
 * Against the real adapters, with the pairs the thresholds were calibrated on.
 * Legitimate transliterations must clear the official-list floor (85); the
 * coincidences the first customer rescreen alerted on must not reach the
 * default alert threshold (50).
 */
describe('scoreMatch — NAME with the real encoder and similarity', () => {
  const deps = { phoneticEncoder: new TalismanPhoneticEncoder(), similarityCalculator: new TalismanSimilarityCalculator() };

  it.each([
    ['Muammar Qaddafi', 'Muammar GADDAFI'],
    ['Osama bin Laden', 'Usama BIN LADIN'],
    ['Mohammed Hassan Akhund', 'Muhammad HASSAN AKHUND'],
    ['Juan Carlos Perez Gomez', 'Juan Carlos PÉREZ GÓMEZ'],
    ['Wladimir Putin', 'Vladimir PUTIN'],
    ['Aiman Muhammad Rabi al Zawahiri', 'Aiman Muhammad Rabi AL-ZAWAHIRI'],
    ['Aiman al Zawahiri', 'Ayman AL-ZAWAHIRI'],
  ])('matches %s with %s above the official floor', (subject, listed) => {
    expect(scoreMatch('NAME', subject, listed, deps)).toBeGreaterThanOrEqual(85);
  });

  it.each([
    ['Danial Tate', 'Daniel TUITO'],
    ['Alejandro Morales Ocampo', 'Alejandro TREVINO MORALES'],
    ['Nicholas Trosclair', 'Nicholas TRUSCHALOV'],
    ['Miguel Angel Diaz', 'Miguel Angel CONTREAS'],
    ['Veronica alejandra Solis Duran', 'Ruben Alejandro VALENZUELA ZUNIGA'],
    ['France', 'FRUNZE'],
    ['Rfc', 'RVC'],
    ['Bentley read', 'BENTLEY'],
  ])('does not alert %s against %s', (subject, listed) => {
    expect(scoreMatch('NAME', subject, listed, deps)).toBeLessThan(50);
  });

  it.each([
    ['Daniela Rodriguez', 'Daniel RODRIGUEZ OLIVERA'],
    ['Carlos Martin', 'Carlos Mario MARTINEZ CASAS'],
    ['Fabian Lopez', 'Fabian Felipe VERA LOPEZ'],
    ['Marisol Herrera', 'Mario Alberto HERRERA SANCHEZ'],
  ])('keeps %s vs %s below the official floor', (subject, listed) => {
    expect(scoreMatch('NAME', subject, listed, deps)).toBeLessThan(85);
  });
});

describe('scoreMatch — DOCUMENT', () => {
  it('scores 100 on an exact match without calling the similarity calculator', () => {
    const similarityCalculator = fixedSimilarityCalculator(0, 0);
    const phoneticEncoder = firstLetterEncoder();

    const score = scoreMatch('DOCUMENT', '12345678', '12345678', { phoneticEncoder, similarityCalculator });

    expect(score).toBe(100);
    expect(similarityCalculator.levenshtein).not.toHaveBeenCalled();
  });

  it('scores proportionally to levenshtein distance when within tolerance (<=2)', () => {
    const similarityCalculator = fixedSimilarityCalculator(0, 1);
    const phoneticEncoder = firstLetterEncoder();

    const score = scoreMatch('DOCUMENT', '12345678', '12345679', { phoneticEncoder, similarityCalculator });

    // round(100*(1 - 1/8)) = 88
    expect(score).toBe(88);
  });

  it('scores 0 when levenshtein distance exceeds tolerance (>2)', () => {
    const similarityCalculator = fixedSimilarityCalculator(0, 3);
    const phoneticEncoder = firstLetterEncoder();

    const score = scoreMatch('DOCUMENT', '12345678', '99999999', { phoneticEncoder, similarityCalculator });

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
