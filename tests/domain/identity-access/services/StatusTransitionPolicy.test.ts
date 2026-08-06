import { ORGANIZATION_TRANSITIONS } from '../../../../src/modules/identity-access/domain/services/transitions.js';
import { assertTransitionAllowed } from '../../../../src/modules/identity-access/domain/services/StatusTransitionPolicy.js';
import { createTransitionActor } from '../../../../src/modules/identity-access/domain/model/value-objects/TransitionActor.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

describe('ORGANIZATION_TRANSITIONS', () => {
  it('is a lookup table, not an if/switch cascade — every status has an explicit edge list', () => {
    expect(ORGANIZATION_TRANSITIONS).toEqual({
      ACTIVE: ['INACTIVE', 'SUSPENDED', 'DISABLED'],
      INACTIVE: ['ACTIVE', 'SUSPENDED', 'DISABLED'],
      SUSPENDED: ['ACTIVE', 'INACTIVE', 'DISABLED'],
      DISABLED: ['ACTIVE'],
    });
  });
});

describe('assertTransitionAllowed (organizations)', () => {
  const platformAdmin = createTransitionActor(true);
  const regularActor = createTransitionActor(false);

  it('(1) allows a valid ACTIVE -> SUSPENDED transition by a platform-admin', () => {
    expect(() =>
      assertTransitionAllowed(ORGANIZATION_TRANSITIONS, 'ACTIVE', 'SUSPENDED', platformAdmin),
    ).not.toThrow();
  });

  it('(2) rejects a no-op INACTIVE -> INACTIVE transition as INVALID_TRANSITION', () => {
    expect.assertions(2);
    try {
      assertTransitionAllowed(ORGANIZATION_TRANSITIONS, 'INACTIVE', 'INACTIVE', platformAdmin);
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('INVALID_TRANSITION');
    }
  });

  it.each(['INACTIVE', 'SUSPENDED'] as const)(
    '(3) rejects DISABLED -> %s as INVALID_TRANSITION',
    (next) => {
      expect.assertions(2);
      try {
        assertTransitionAllowed(ORGANIZATION_TRANSITIONS, 'DISABLED', next, platformAdmin);
      } catch (error) {
        expect(error).toBeInstanceOf(IdentityAccessError);
        expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('INVALID_TRANSITION');
      }
    },
  );

  it('(4) allows a platform-admin to reactivate DISABLED -> ACTIVE', () => {
    expect(() =>
      assertTransitionAllowed(ORGANIZATION_TRANSITIONS, 'DISABLED', 'ACTIVE', platformAdmin),
    ).not.toThrow();
  });

  it('(5) rejects a non-platform-admin reactivating DISABLED -> ACTIVE as FORBIDDEN_REACTIVATION', () => {
    expect.assertions(2);
    try {
      assertTransitionAllowed(ORGANIZATION_TRANSITIONS, 'DISABLED', 'ACTIVE', regularActor);
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('FORBIDDEN_REACTIVATION');
    }
  });
});
