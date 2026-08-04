import { ORGANIZATION_TRANSITIONS } from '../../../../src/modules/identity-access/domain/services/transitions.js';
import { assertTransitionAllowed } from '../../../../src/modules/identity-access/domain/services/StatusTransitionPolicy.js';
import { createTransitionActor } from '../../../../src/modules/identity-access/domain/model/value-objects/TransitionActor.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

describe('ORGANIZATION_TRANSITIONS', () => {
  it('is a lookup table, not an if/switch cascade — every status has an explicit edge list', () => {
    expect(ORGANIZATION_TRANSITIONS).toEqual({
      ACTIVO: ['INACTIVO', 'SUSPENDIDO', 'DESHABILITADO'],
      INACTIVO: ['ACTIVO', 'SUSPENDIDO', 'DESHABILITADO'],
      SUSPENDIDO: ['ACTIVO', 'INACTIVO', 'DESHABILITADO'],
      DESHABILITADO: ['ACTIVO'],
    });
  });
});

describe('assertTransitionAllowed (organizations)', () => {
  const platformAdmin = createTransitionActor(true);
  const regularActor = createTransitionActor(false);

  it('(1) allows a valid ACTIVO -> SUSPENDIDO transition by a platform-admin', () => {
    expect(() =>
      assertTransitionAllowed(ORGANIZATION_TRANSITIONS, 'ACTIVO', 'SUSPENDIDO', platformAdmin),
    ).not.toThrow();
  });

  it('(2) rejects a no-op INACTIVO -> INACTIVO transition as INVALID_TRANSITION', () => {
    expect.assertions(2);
    try {
      assertTransitionAllowed(ORGANIZATION_TRANSITIONS, 'INACTIVO', 'INACTIVO', platformAdmin);
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('INVALID_TRANSITION');
    }
  });

  it.each(['INACTIVO', 'SUSPENDIDO'] as const)(
    '(3) rejects DESHABILITADO -> %s as INVALID_TRANSITION',
    (next) => {
      expect.assertions(2);
      try {
        assertTransitionAllowed(ORGANIZATION_TRANSITIONS, 'DESHABILITADO', next, platformAdmin);
      } catch (error) {
        expect(error).toBeInstanceOf(IdentityAccessError);
        expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('INVALID_TRANSITION');
      }
    },
  );

  it('(4) allows a platform-admin to reactivate DESHABILITADO -> ACTIVO', () => {
    expect(() =>
      assertTransitionAllowed(ORGANIZATION_TRANSITIONS, 'DESHABILITADO', 'ACTIVO', platformAdmin),
    ).not.toThrow();
  });

  it('(5) rejects a non-platform-admin reactivating DESHABILITADO -> ACTIVO as FORBIDDEN_REACTIVATION', () => {
    expect.assertions(2);
    try {
      assertTransitionAllowed(ORGANIZATION_TRANSITIONS, 'DESHABILITADO', 'ACTIVO', regularActor);
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('FORBIDDEN_REACTIVATION');
    }
  });
});
