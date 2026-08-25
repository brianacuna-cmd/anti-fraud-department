import { oid } from '../../../../support/oid.js';
import { createAuthContext } from '../../../../../src/shared/kernel/AuthContext.js';
import {
  CASE_WORK_ROLES,
  OVERSIGHT_READ_ROLES,
  requireOperationalRole,
  requireReadRole,
  SUPERVISION_ROLES,
} from '../../../../../src/modules/case-management/application/authorization/policy.js';
import { CaseManagementError } from '../../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const ORG = oid('org-1');

function user(roleId: string | null) {
  return createAuthContext({
    userId: oid('user-1'),
    organizationId: ORG,
    actorType: 'USER',
    roleId,
  });
}

const ORGANIZATION = createAuthContext({
  userId: ORG,
  organizationId: ORG,
  actorType: 'ORGANIZATION',
  roleId: null,
});

function expectForbidden(run: () => void): CaseManagementError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(CaseManagementError);
    expect((error as CaseManagementError).code).toBe('FORBIDDEN_ROLE');
    return error as CaseManagementError;
  }
  throw new Error('expected the guard to throw');
}

describe('requireOperationalRole', () => {
  it('allows SUPERVISOR on a supervision-only operation', () => {
    expect(() => requireOperationalRole(user('SUPERVISOR'), SUPERVISION_ROLES)).not.toThrow();
  });

  it('allows ANALYST on case work', () => {
    expect(() => requireOperationalRole(user('ANALYST'), CASE_WORK_ROLES)).not.toThrow();
  });

  it('rejects ANALYST on a supervision-only operation', () => {
    expectForbidden(() => requireOperationalRole(user('ANALYST'), SUPERVISION_ROLES));
  });

  /**
   * The segregation-of-duties control: ADMIN administers people, not cases.
   * If this test falls over, a single account can grant permissions AND use
   * them.
   */
  it('rejects ADMIN as read-only, on every operational allow-list', () => {
    for (const allowed of [SUPERVISION_ROLES, CASE_WORK_ROLES]) {
      const error = expectForbidden(() => requireOperationalRole(user('ADMIN'), allowed));
      expect(error.metadata).toMatchObject({ actor: 'ADMIN', readOnly: true });
    }
  });

  it('rejects AUDITOR as read-only', () => {
    const error = expectForbidden(() => requireOperationalRole(user('AUDITOR'), CASE_WORK_ROLES));
    expect(error.metadata).toMatchObject({ actor: 'AUDITOR', readOnly: true });
  });

  it('rejects the ORGANIZATION actor as read-only, not as a null role', () => {
    const error = expectForbidden(() => requireOperationalRole(ORGANIZATION, SUPERVISION_ROLES));
    expect(error.metadata).toMatchObject({ actor: 'ORGANIZATION', readOnly: true });
    expect(error.message).not.toContain('null');
  });

  it('rejects a USER with no role at all', () => {
    expectForbidden(() => requireOperationalRole(user(null), CASE_WORK_ROLES));
  });
});

describe('requireReadRole', () => {
  it.each(['SUPERVISOR', 'ADMIN', 'AUDITOR'])('allows %s to read oversight data', (roleId) => {
    expect(() => requireReadRole(user(roleId), OVERSIGHT_READ_ROLES)).not.toThrow();
  });

  /**
   * The regression that motivated all of this: the organization ALWAYS arrives
   * with `roleId: null`, so the previous guard denied even reads.
   */
  it('allows the ORGANIZATION actor even though it carries no roleId', () => {
    expect(() => requireReadRole(ORGANIZATION, OVERSIGHT_READ_ROLES)).not.toThrow();
  });

  it('rejects ANALYST on oversight-only reads', () => {
    expectForbidden(() => requireReadRole(user('ANALYST'), OVERSIGHT_READ_ROLES));
  });
});
