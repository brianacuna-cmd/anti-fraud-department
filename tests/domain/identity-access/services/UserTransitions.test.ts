import { USER_TRANSITIONS } from '../../../../src/modules/identity-access/domain/services/transitions.js';
import {
  assertTransitionAllowed,
  type ReactivationEdge,
} from '../../../../src/modules/identity-access/domain/services/StatusTransitionPolicy.js';
import { createTransitionActor } from '../../../../src/modules/identity-access/domain/model/value-objects/TransitionActor.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';
import type { LifecycleStatus } from '../../../../src/modules/identity-access/domain/model/value-objects/LifecycleStatus.js';

const REACTIVATION_EDGE: ReactivationEdge<LifecycleStatus> = { from: 'DISABLED', to: 'ACTIVE' };

describe('USER_TRANSITIONS', () => {
  it('is a lookup table with the same edge shape as organizations', () => {
    expect(USER_TRANSITIONS).toEqual({
      ACTIVE: ['INACTIVE', 'SUSPENDED', 'DISABLED'],
      INACTIVE: ['ACTIVE', 'SUSPENDED', 'DISABLED'],
      SUSPENDED: ['ACTIVE', 'INACTIVE', 'DISABLED'],
      DISABLED: ['ACTIVE'],
    });
  });
});

describe('assertTransitionAllowed (users)', () => {
  const platformAdmin = createTransitionActor(true);
  const orgAdmin = createTransitionActor(false);

  it('(1) allows a valid SUSPENDED -> INACTIVE transition by an org-admin', () => {
    expect(() =>
      assertTransitionAllowed(USER_TRANSITIONS, 'SUSPENDED', 'INACTIVE', orgAdmin),
    ).not.toThrow();
  });

  it('(2) rejects a no-op ACTIVE -> ACTIVE transition as INVALID_TRANSITION', () => {
    expect.assertions(2);
    try {
      assertTransitionAllowed(USER_TRANSITIONS, 'ACTIVE', 'ACTIVE', orgAdmin);
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('INVALID_TRANSITION');
    }
  });

  it('(3) rejects DISABLED -> SUSPENDED as INVALID_TRANSITION', () => {
    expect.assertions(2);
    try {
      assertTransitionAllowed(USER_TRANSITIONS, 'DISABLED', 'SUSPENDED', orgAdmin);
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('INVALID_TRANSITION');
    }
  });

  it('(4) rejects an org-admin self-reactivating a user in their own org as FORBIDDEN_REACTIVATION', () => {
    expect.assertions(2);
    try {
      assertTransitionAllowed(USER_TRANSITIONS, 'DISABLED', 'ACTIVE', orgAdmin, REACTIVATION_EDGE);
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('FORBIDDEN_REACTIVATION');
    }
  });

  it('(5) allows a platform-admin to reactivate DISABLED -> ACTIVE', () => {
    expect(() =>
      assertTransitionAllowed(USER_TRANSITIONS, 'DISABLED', 'ACTIVE', platformAdmin, REACTIVATION_EDGE),
    ).not.toThrow();
  });

  it('(6) with no reactivationEdge given, DISABLED -> ACTIVE is allowed for any actor (table-valid, no gate)', () => {
    expect(() =>
      assertTransitionAllowed(USER_TRANSITIONS, 'DISABLED', 'ACTIVE', orgAdmin),
    ).not.toThrow();
  });
});
