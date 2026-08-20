import { oid } from '../../../../support/oid.js';
import { createAuthContext } from '../../../../../src/shared/kernel/AuthContext.js';
import { requireRole } from '../../../../../src/modules/case-management/application/authorization/requireRole.js';
import { CaseManagementError } from '../../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const ORG = oid('org-1');
const ALLOWED = ['SUPERVISOR', 'ADMIN'] as const;

describe('requireRole', () => {
  it('allows SUPERVISOR when listed in allowed roles', () => {
    const auth = createAuthContext({
      userId: oid('user-1'),
      organizationId: ORG,
      roleId: 'SUPERVISOR',
    });

    expect(() => requireRole(auth, ALLOWED)).not.toThrow();
  });

  it('allows ADMIN when listed in allowed roles', () => {
    const auth = createAuthContext({
      userId: oid('user-1'),
      organizationId: ORG,
      roleId: 'ADMIN',
    });

    expect(() => requireRole(auth, ALLOWED)).not.toThrow();
  });

  it('rejects ANALYST with FORBIDDEN_ROLE', () => {
    const auth = createAuthContext({
      userId: oid('user-1'),
      organizationId: ORG,
      roleId: 'ANALYST',
    });

    try {
      requireRole(auth, ALLOWED);
      throw new Error('expected requireRole to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('FORBIDDEN_ROLE');
    }
  });

  it('rejects AUDITOR with FORBIDDEN_ROLE', () => {
    const auth = createAuthContext({
      userId: oid('user-1'),
      organizationId: ORG,
      roleId: 'AUDITOR',
    });

    try {
      requireRole(auth, ALLOWED);
      throw new Error('expected requireRole to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('FORBIDDEN_ROLE');
    }
  });

  it('rejects null roleId with FORBIDDEN_ROLE', () => {
    const auth = createAuthContext({
      userId: oid('user-1'),
      organizationId: ORG,
      roleId: null,
    });

    try {
      requireRole(auth, ALLOWED);
      throw new Error('expected requireRole to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('FORBIDDEN_ROLE');
    }
  });
});
