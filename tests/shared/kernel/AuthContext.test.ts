import { createAuthContext, type AuthContext } from '../../../src/shared/kernel/AuthContext.js';

describe('AuthContext', () => {
  it('builds a context with organizationId, actorType, roleId, and sessionId', () => {
    const auth: AuthContext = createAuthContext({
      userId: 'user-1',
      organizationId: 'org-1',
      isPlatformAdmin: true,
      actorType: 'PLATFORM_ADMIN',
      roleId: 'role-1',
      sessionId: 'session-1',
    });

    expect(auth).toEqual({
      userId: 'user-1',
      organizationId: 'org-1',
      isPlatformAdmin: true,
      actorType: 'PLATFORM_ADMIN',
      roleId: 'role-1',
      sessionId: 'session-1',
    });
    expect(Object.keys(auth).sort()).toEqual([
      'actorType',
      'isPlatformAdmin',
      'organizationId',
      'roleId',
      'sessionId',
      'userId',
    ]);
  });

  it('defaults isPlatformAdmin to false when omitted (D4: absent => false)', () => {
    const auth = createAuthContext({ userId: 'user-2', organizationId: 'org-2' });

    expect(auth.isPlatformAdmin).toBe(false);
  });

  it('defaults actorType from isPlatformAdmin when actorType is omitted (D11/D12 mechanical-sweep compatibility)', () => {
    const admin = createAuthContext({ userId: 'admin-1', organizationId: null, isPlatformAdmin: true });
    const user = createAuthContext({ userId: 'user-3', organizationId: 'org-3' });

    expect(admin.actorType).toBe('PLATFORM_ADMIN');
    expect(user.actorType).toBe('USER');
  });

  it('defaults roleId and sessionId to null when omitted', () => {
    const auth = createAuthContext({ userId: 'user-4', organizationId: 'org-4' });

    expect(auth.roleId).toBeNull();
    expect(auth.sessionId).toBeNull();
  });

  it('accepts a null organizationId (design D11 — a platform admin has no organization)', () => {
    const auth = createAuthContext({ userId: 'admin-2', organizationId: null, isPlatformAdmin: true });

    expect(auth.organizationId).toBeNull();
  });
});
