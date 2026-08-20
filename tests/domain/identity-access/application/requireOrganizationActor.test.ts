import { oid } from '../../../support/oid.js';
import { requireOrganizationActor } from '../../../../src/modules/identity-access/application/authorization/requireOrganizationActor.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

describe('requireOrganizationActor', () => {
  it('allows an ORGANIZATION actor to proceed (returns without throwing)', () => {
    const auth = createAuthContext({ userId: oid('u1'), organizationId: oid('org-1'), actorType: 'ORGANIZATION' });

    expect(() => requireOrganizationActor(auth)).not.toThrow();
  });

  it('rejects a USER actor with FORBIDDEN_CROSS_TENANT', () => {
    const auth = createAuthContext({ userId: oid('u1'), organizationId: oid('org-1'), isPlatformAdmin: false });

    expect.assertions(2);
    try {
      requireOrganizationActor(auth);
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
  });

  it('rejects a PLATFORM_ADMIN actor with FORBIDDEN_CROSS_TENANT', () => {
    const auth = createAuthContext({ userId: oid('u1'), organizationId: null, isPlatformAdmin: true });

    expect.assertions(2);
    try {
      requireOrganizationActor(auth);
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
  });
});
