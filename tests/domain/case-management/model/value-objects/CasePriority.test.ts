import { createCasePriority } from '../../../../../src/modules/case-management/domain/model/value-objects/CasePriority.js';
import { CaseManagementError } from '../../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

describe('createCasePriority', () => {
  it.each(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])('accepts %s', (value) => {
    expect(createCasePriority(value)).toBe(value);
  });

  it('rejects an unknown priority', () => {
    expect(() => createCasePriority('URGENT')).toThrow(CaseManagementError);
  });
});
