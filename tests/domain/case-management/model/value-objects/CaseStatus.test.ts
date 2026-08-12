import { createCaseStatus } from '../../../../../src/modules/case-management/domain/model/value-objects/CaseStatus.js';
import { CaseManagementError } from '../../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

describe('createCaseStatus', () => {
  it.each(['OPEN', 'IN_REVIEW', 'RESOLVED', 'ARCHIVED'])('accepts %s', (value) => {
    expect(createCaseStatus(value)).toBe(value);
  });

  it('rejects an unknown status', () => {
    expect(() => createCaseStatus('CLOSED')).toThrow(CaseManagementError);
  });
});
