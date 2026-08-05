import { USER_TRANSITIONS } from '../../../../src/modules/identity-access/domain/services/transitions.js';
import { assertTransitionAllowed } from '../../../../src/modules/identity-access/domain/services/StatusTransitionPolicy.js';
import { createTransitionActor } from '../../../../src/modules/identity-access/domain/model/value-objects/TransitionActor.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

describe('USER_TRANSITIONS', () => {
  it('is a lookup table with the same edge shape as organizations', () => {
    expect(USER_TRANSITIONS).toEqual({
      ACTIVO: ['INACTIVO', 'SUSPENDIDO', 'DESHABILITADO'],
      INACTIVO: ['ACTIVO', 'SUSPENDIDO', 'DESHABILITADO'],
      SUSPENDIDO: ['ACTIVO', 'INACTIVO', 'DESHABILITADO'],
      DESHABILITADO: ['ACTIVO'],
    });
  });
});

describe('assertTransitionAllowed (users)', () => {
  const platformAdmin = createTransitionActor(true);
  const orgAdmin = createTransitionActor(false);

  it('(1) allows a valid SUSPENDIDO -> INACTIVO transition by an org-admin', () => {
    expect(() =>
      assertTransitionAllowed(USER_TRANSITIONS, 'SUSPENDIDO', 'INACTIVO', orgAdmin),
    ).not.toThrow();
  });

  it('(2) rejects a no-op ACTIVO -> ACTIVO transition as INVALID_TRANSITION', () => {
    expect.assertions(2);
    try {
      assertTransitionAllowed(USER_TRANSITIONS, 'ACTIVO', 'ACTIVO', orgAdmin);
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('INVALID_TRANSITION');
    }
  });

  it('(3) rejects DESHABILITADO -> SUSPENDIDO as INVALID_TRANSITION', () => {
    expect.assertions(2);
    try {
      assertTransitionAllowed(USER_TRANSITIONS, 'DESHABILITADO', 'SUSPENDIDO', orgAdmin);
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('INVALID_TRANSITION');
    }
  });

  it('(4) rejects an org-admin self-reactivating a user in their own org as FORBIDDEN_REACTIVATION', () => {
    expect.assertions(2);
    try {
      assertTransitionAllowed(USER_TRANSITIONS, 'DESHABILITADO', 'ACTIVO', orgAdmin);
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('FORBIDDEN_REACTIVATION');
    }
  });

  it('(5) allows a platform-admin to reactivate DESHABILITADO -> ACTIVO', () => {
    expect(() =>
      assertTransitionAllowed(USER_TRANSITIONS, 'DESHABILITADO', 'ACTIVO', platformAdmin),
    ).not.toThrow();
  });
});
