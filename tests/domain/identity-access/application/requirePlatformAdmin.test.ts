import { oid } from '../../../support/oid.js';
import { requirePlatformAdmin } from '../../../../src/modules/identity-access/application/authorization/requirePlatformAdmin.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

describe('requirePlatformAdmin', () => {
  it('allows a platform-admin actor to proceed (returns without throwing)', () => {
    const auth = createAuthContext({ userId: oid('u1'), organizationId: oid('o1'), isPlatformAdmin: true });

    expect(() => requirePlatformAdmin(auth)).not.toThrow();
  });

  it('rejects a non-platform-admin actor with FORBIDDEN_CROSS_TENANT before any domain logic', () => {
    const auth = createAuthContext({ userId: oid('u1'), organizationId: oid('o1'), isPlatformAdmin: false });

    expect.assertions(2);
    try {
      requirePlatformAdmin(auth);
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
  });
});
