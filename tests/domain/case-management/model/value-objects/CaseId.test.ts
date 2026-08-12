import { createCaseId, generateCaseId } from '../../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { CaseManagementError } from '../../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

describe('createCaseId', () => {
  it('accepts a non-empty string', () => {
    expect(createCaseId('case-1')).toBe('case-1');
  });

  it('rejects an empty string', () => {
    expect(() => createCaseId('')).toThrow(CaseManagementError);
  });
});

describe('generateCaseId', () => {
  it('mints a fresh non-empty id', () => {
    expect(generateCaseId().length).toBeGreaterThan(0);
  });
});
