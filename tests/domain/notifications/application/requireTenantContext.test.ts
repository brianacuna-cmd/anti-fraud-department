import { requireTenantContext } from '../../../../src/modules/notifications/application/authorization/requireTenantContext.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { NotificationsError } from '../../../../src/modules/notifications/domain/errors/NotificationsError.js';

describe('requireTenantContext', () => {
  it('returns the organizationId when the actor has a tenant context', () => {
    const auth = createAuthContext({ userId: 'u1', organizationId: 'org-1' });

    expect(requireTenantContext(auth)).toBe('org-1');
  });

  it('rejects a null organizationId with FORBIDDEN_CROSS_TENANT (platform admin has no organization)', () => {
    const auth = createAuthContext({
      userId: 'admin-1',
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
