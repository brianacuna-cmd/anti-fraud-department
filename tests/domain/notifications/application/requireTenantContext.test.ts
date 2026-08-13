import { oid } from '../../../support/oid.js';
import { requireTenantContext } from '../../../../src/modules/notifications/application/authorization/requireTenantContext.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { NotificationsError } from '../../../../src/modules/notifications/domain/errors/NotificationsError.js';

describe('requireTenantContext', () => {
  it('returns the organizationId when the actor has a tenant context', () => {
    const auth = createAuthContext({ userId: oid('u1'), organizationId: oid('org-1') });

    expect(requireTenantContext(auth)).toBe(oid('org-1'));
  });

  it('rejects a null organizationId with FORBIDDEN_CROSS_TENANT (platform admin has no organization)', () => {
    const auth = createAuthContext({
      userId: oid('admin-1'),
      organizationId: null,
      isPlatformAdmin: true,
    });

    expect.assertions(2);
    try {
      requireTenantContext(auth);
    } catch (error) {
      expect(error).toBeInstanceOf(NotificationsError);
      expect((error as InstanceType<typeof NotificationsError>).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
  });
});
