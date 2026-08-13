import { oid } from '../../../../support/oid.js';
import { createAssignedTo } from '../../../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';
import { CaseManagementError } from '../../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

describe('createAssignedTo', () => {
  it('accepts type USER with a non-empty id', () => {
    expect(createAssignedTo('USER', oid('user-1'))).toEqual({ type: 'USER', id: oid('user-1') });
  });

  it('accepts type ROLE with a non-empty id', () => {
    expect(createAssignedTo('ROLE', 'role-1')).toEqual({ type: 'ROLE', id: 'role-1' });
  });

  it('rejects an unknown type', () => {
    expect(() => createAssignedTo('TEAM', 'team-1')).toThrow(CaseManagementError);
  });

  it('rejects an empty id', () => {
    expect(() => createAssignedTo('USER', '')).toThrow(CaseManagementError);
  });
});
