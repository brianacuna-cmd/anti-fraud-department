import { createRiskScore } from '../../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { CaseManagementError } from '../../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

describe('createRiskScore', () => {
  it.each([0, 50, 100])('accepts %d', (value) => {
    expect(createRiskScore(value)).toBe(value);
  });

  it('rejects a negative value', () => {
    expect(() => createRiskScore(-1)).toThrow(CaseManagementError);
  });

  it('rejects a value above 100', () => {
    expect(() => createRiskScore(101)).toThrow(CaseManagementError);
  });

  it('rejects a non-integer value', () => {
    expect(() => createRiskScore(50.5)).toThrow(CaseManagementError);
  });
});
