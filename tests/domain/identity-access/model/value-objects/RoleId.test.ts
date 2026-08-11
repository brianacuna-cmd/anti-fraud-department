import {
  createRoleId,
  isAssignableUserRole,
  ASSIGNABLE_USER_ROLES,
} from '../../../../../src/modules/identity-access/domain/model/value-objects/RoleId.js';
import { IdentityAccessError } from '../../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

describe('RoleId', () => {
  it.each(['ADMIN', 'SUPERVISOR', 'ANALYST', 'AUDITOR'])('accepts the known role id "%s"', (value) => {
    expect(createRoleId(value)).toBe(value);
  });

  it('rejects an unknown role id with INVARIANT_VIOLATION', () => {
    expect.assertions(2);
    try {
      createRoleId('MANAGER');
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('INVARIANT_VIOLATION');
    }
  });

  it('excludes ADMIN from ASSIGNABLE_USER_ROLES — it is the organization\'s own role, never a User\'s', () => {
    expect(ASSIGNABLE_USER_ROLES.has('ADMIN')).toBe(false);
    expect(isAssignableUserRole('ADMIN')).toBe(false);
  });

  it.each(['SUPERVISOR', 'ANALYST', 'AUDITOR'])('treats "%s" as user-assignable', (value) => {
    expect(isAssignableUserRole(value)).toBe(true);
  });

  it('treats an unknown value as not user-assignable', () => {
    expect(isAssignableUserRole('MANAGER')).toBe(false);
  });
});
