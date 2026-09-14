import {
  createCaseNumber,
  formatCaseNumber,
} from '../../../../../src/modules/case-management/domain/model/value-objects/CaseNumber.js';

describe('CaseNumber', () => {
  it('formats year and sequence as FD-YYYY-NNNNNN', () => {
    expect(formatCaseNumber(2026, 42)).toBe('FD-2026-000042');
  });

  it('keeps growing past six digits instead of wrapping', () => {
    expect(formatCaseNumber(2026, 1_234_567)).toBe('FD-2026-1234567');
  });

  it('rejects non-positive sequences and malformed years', () => {
    expect(() => formatCaseNumber(2026, 0)).toThrow();
    expect(() => formatCaseNumber(26, 1)).toThrow();
  });

  it('validates persisted values', () => {
    expect(createCaseNumber('FD-2026-000001')).toBe('FD-2026-000001');
    expect(() => createCaseNumber('2026-000001')).toThrow();
    expect(() => createCaseNumber('FD-2026-01')).toThrow();
  });
});
