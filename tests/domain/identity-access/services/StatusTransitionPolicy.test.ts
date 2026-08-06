import { ORGANIZATION_STATUS_TRANSITIONS } from '../../../../src/modules/identity-access/domain/services/transitions.js';
import { assertTransitionAllowed } from '../../../../src/modules/identity-access/domain/services/StatusTransitionPolicy.js';
import { createTransitionActor } from '../../../../src/modules/identity-access/domain/model/value-objects/TransitionActor.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

describe('ORGANIZATION_STATUS_TRANSITIONS (design D10, supersedes D9)', () => {
  it('is a lookup table, not an if/switch cascade — every status has an explicit edge list', () => {
    expect(ORGANIZATION_STATUS_TRANSITIONS).toEqual({
      ACTIVE: ['SUSPENDED', 'CANCELLED'],
      SUSPENDED: ['ACTIVE', 'CANCELLED'],
      CANCELLED: [],
    });
  });
});

describe('assertTransitionAllowed (organizations) — no reactivationEdge (design D10)', () => {
  const platformAdmin = createTransitionActor(true);
  const regularActor = createTransitionActor(false);

  it('(1) allows a valid ACTIVE -> SUSPENDED transition by a platform-admin', () => {
    expect(() =>
      assertTransitionAllowed(ORGANIZATION_STATUS_TRANSITIONS, 'ACTIVE', 'SUSPENDED', platformAdmin),
    ).not.toThrow();
  });

  it('(2) rejects a no-op ACTIVE -> ACTIVE transition as INVALID_TRANSITION', () => {
    expect.assertions(2);
    try {
      assertTransitionAllowed(ORGANIZATION_STATUS_TRANSITIONS, 'ACTIVE', 'ACTIVE', platformAdmin);
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('INVALID_TRANSITION');
    }
  });

  it.each(['ACTIVE', 'SUSPENDED'] as const)(
    '(3) rejects CANCELLED -> %s as INVALID_TRANSITION — CANCELLED is terminal for any actor',
    (next) => {
      expect.assertions(2);
      try {
        assertTransitionAllowed(ORGANIZATION_STATUS_TRANSITIONS, 'CANCELLED', next, platformAdmin);
      } catch (error) {
        expect(error).toBeInstanceOf(IdentityAccessError);
        expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('INVALID_TRANSITION');
      }
    },
  );

  it('(4) allows SUSPENDED -> ACTIVE reactivation with NO gate, since no reactivationEdge is passed for organizations', () => {
    expect(() =>
      assertTransitionAllowed(ORGANIZATION_STATUS_TRANSITIONS, 'SUSPENDED', 'ACTIVE', regularActor),
    ).not.toThrow();
  });

  it('(5) rejects ACTIVE -> CANCELLED for a non-platform-admin actor purely by table absence, never FORBIDDEN_REACTIVATION', () => {
    // ACTIVE -> CANCELLED IS a valid table edge, so this must succeed at the
    // policy layer — application-layer requirePlatformAdmin is what actually
    // gates organizations routes (design D3), not this domain-level policy.
    expect(() =>
      assertTransitionAllowed(ORGANIZATION_STATUS_TRANSITIONS, 'ACTIVE', 'CANCELLED', regularActor),
    ).not.toThrow();
  });
});
