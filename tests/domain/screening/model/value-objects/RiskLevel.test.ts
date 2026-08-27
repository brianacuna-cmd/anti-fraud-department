import { createRiskLevel, isRiskLevel } from '../../../../../src/modules/screening/domain/model/value-objects/RiskLevel.js';
import { ScreeningError } from '../../../../../src/modules/screening/domain/errors/ScreeningError.js';

describe('createRiskLevel', () => {
  it.each(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])('accepts %s', (value) => {
    expect(createRiskLevel(value)).toBe(value);
  });

  it('rejects an unknown risk level', () => {
    expect(() => createRiskLevel('UNKNOWN')).toThrow(ScreeningError);
  });
});

describe('isRiskLevel', () => {
  it('returns true for all valid values', () => {
    expect(isRiskLevel('LOW')).toBe(true);
    expect(isRiskLevel('MEDIUM')).toBe(true);
    expect(isRiskLevel('HIGH')).toBe(true);
    expect(isRiskLevel('CRITICAL')).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isRiskLevel('EXTREME')).toBe(false);
    expect(isRiskLevel(42)).toBe(false);
    expect(isRiskLevel(null)).toBe(false);
  });
});
