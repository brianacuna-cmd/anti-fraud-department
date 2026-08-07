import { requireTenantContext } from '../../../../src/modules/identity-access/application/authorization/requireTenantContext.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

describe('requireTenantContext', () => {
  it('returns the organizationId when the actor has a tenant context', () => {
    const auth = createAuthContext({ userId: 'u1', organizationId: 'org-1' });

    expect(requireTenantContext(auth)).toBe('org-1');
  });

  it('rejects a null organizationId with FORBIDDEN_CROSS_TENANT (design D11 — a platform admin has no organization)', () => {
    const auth = createAuthContext({
      userId: 'admin-1',
      organizationId: null,
      actorType: 'PLATFORM_ADMIN',
    });

    expect.assertions(2);
    try {
      requireTenantContext(auth);
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
  });
});
