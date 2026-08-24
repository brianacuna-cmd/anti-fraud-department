import { TalismanSimilarityCalculator } from '../../../../src/modules/screening/infrastructure/adapters/outbound/matching/TalismanSimilarityCalculator.js';

describe('TalismanSimilarityCalculator', () => {
  const calculator = new TalismanSimilarityCalculator();

  it('computes Jaro-Winkler similarity for known reference values', () => {
    expect(calculator.jaroWinkler('martha', 'marhta')).toBeCloseTo(0.9611, 4);
  });

  it('returns 1 for identical strings under Jaro-Winkler', () => {
    expect(calculator.jaroWinkler('smith', 'smith')).toBe(1);
  });

  it('computes Levenshtein distance for known reference values', () => {
    expect(calculator.levenshtein('kitten', 'sitting')).toBe(3);
  });

  it('returns 0 Levenshtein distance for identical strings', () => {
    expect(calculator.levenshtein('smith', 'smith')).toBe(0);
  });

  it('is token-sort aware: jaroWinkler treats reordered tokens as highly similar', () => {
    const inOrder = calculator.jaroWinkler('john smith', 'john smith');
    const reordered = calculator.jaroWinkler('john smith', 'smith john');
    expect(reordered).toBeGreaterThan(0.9);
    expect(inOrder).toBe(1);
  });
});
