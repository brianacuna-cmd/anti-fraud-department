import { oid } from '../../../../support/oid.js';
import { requirePlatformAdmin } from '../../../../../src/modules/case-management/application/authorization/requirePlatformAdmin.js';
import { createAuthContext } from '../../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

describe('requirePlatformAdmin (case-management twin)', () => {
  it('allows a PLATFORM_ADMIN actor to proceed without throwing', () => {
    const auth = createAuthContext({
      userId: oid('admin-1'),
      organizationId: null,
      actorType: 'PLATFORM_ADMIN',
    });

    expect(() => requirePlatformAdmin(auth)).not.toThrow();
  });

  it('rejects a USER actor with FORBIDDEN_CROSS_TENANT before any domain logic runs', () => {
    const auth = createAuthContext({
      userId: oid('user-1'),
      organizationId: oid('org-1'),
      actorType: 'USER',
    });

    expect.assertions(2);
    try {
      requirePlatformAdmin(auth);
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
  });

  it('rejects an ORGANIZATION actor with FORBIDDEN_CROSS_TENANT', () => {
    const auth = createAuthContext({
      userId: oid('org-actor-1'),
      organizationId: oid('org-1'),
      actorType: 'ORGANIZATION',
    });

    expect.assertions(1);
    try {
      requirePlatformAdmin(auth);
    } catch (error) {
      expect((error as CaseManagementError).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
  });
});
