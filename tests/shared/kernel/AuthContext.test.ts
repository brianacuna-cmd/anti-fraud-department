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
      ipAddress: '203.0.113.1',
    });

    expect(auth).toEqual({
      userId: 'user-1',
      organizationId: 'org-1',
      isPlatformAdmin: true,
      actorType: 'PLATFORM_ADMIN',
      roleId: 'role-1',
      sessionId: 'session-1',
      ipAddress: '203.0.113.1',
      purpose: 'full',
      mfaJti: null,
    });
    expect(Object.keys(auth).sort()).toEqual([
      'actorType',
      'ipAddress',
      'isPlatformAdmin',
      'mfaJti',
      'organizationId',
      'purpose',
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

  it('defaults ipAddress to null when omitted (design D-A7: additive, optional field)', () => {
    const auth = createAuthContext({ userId: 'user-5', organizationId: 'org-5' });

    expect(auth.ipAddress).toBeNull();
  });

  it('accepts an explicit ipAddress', () => {
    const auth = createAuthContext({ userId: 'user-6', organizationId: 'org-6', ipAddress: '198.51.100.7' });

    expect(auth.ipAddress).toBe('198.51.100.7');
  });

  it('defaults purpose to "full" when omitted (design D3 — additive, optional field)', () => {
    const auth = createAuthContext({ userId: 'user-7', organizationId: 'org-7' });

    expect(auth.purpose).toBe('full');
  });

  it('accepts an explicit challenge/enrollment purpose', () => {
    const challenge = createAuthContext({ userId: 'user-8', organizationId: 'org-8', purpose: 'challenge' });
    const enrollment = createAuthContext({ userId: 'user-9', organizationId: 'org-9', purpose: 'enrollment' });

    expect(challenge.purpose).toBe('challenge');
    expect(enrollment.purpose).toBe('enrollment');
  });

  it('defaults mfaJti to null when omitted (two-step-login PR3 — additive, optional field)', () => {
    const auth = createAuthContext({ userId: 'user-10', organizationId: 'org-10' });

    expect(auth.mfaJti).toBeNull();
  });

  it('accepts an explicit mfaJti', () => {
    const auth = createAuthContext({ userId: 'user-11', organizationId: 'org-11', purpose: 'enrollment', mfaJti: 'jti-1' });

    expect(auth.mfaJti).toBe('jti-1');
  });
});
