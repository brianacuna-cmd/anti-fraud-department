import { createAuthContext, type AuthContext } from '../../../src/shared/kernel/AuthContext.js';

describe('AuthContext', () => {
  it('builds a context with exactly userId, organizationId, and isPlatformAdmin', () => {
    const auth: AuthContext = createAuthContext({
      userId: 'user-1',
      organizationId: 'org-1',
      isPlatformAdmin: true,
    });

    expect(auth).toEqual({
      userId: 'user-1',
      organizationId: 'org-1',
      isPlatformAdmin: true,
    });
    expect(Object.keys(auth).sort()).toEqual(['isPlatformAdmin', 'organizationId', 'userId']);
  });

  it('defaults isPlatformAdmin to false when omitted (D4: absent => false)', () => {
    const auth = createAuthContext({ userId: 'user-2', organizationId: 'org-2' });

    expect(auth.isPlatformAdmin).toBe(false);
  });
});
