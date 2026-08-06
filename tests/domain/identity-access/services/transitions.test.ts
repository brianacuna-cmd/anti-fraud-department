import {
  ORGANIZATION_STATUS_TRANSITIONS,
  USER_TRANSITIONS,
  type TransitionTable,
} from '../../../../src/modules/identity-access/domain/services/transitions.js';
import type { OrganizationStatus } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationStatus.js';
import type { LifecycleStatus } from '../../../../src/modules/identity-access/domain/model/value-objects/LifecycleStatus.js';

describe('TransitionTable<S> — generic lookup table shape (design D10)', () => {
  it('ORGANIZATION_STATUS_TRANSITIONS is a full 3x3 matrix with CANCELLED terminal', () => {
    expect(ORGANIZATION_STATUS_TRANSITIONS).toEqual({
      ACTIVE: ['SUSPENDED', 'CANCELLED'],
      SUSPENDED: ['ACTIVE', 'CANCELLED'],
      CANCELLED: [],
    });
  });

  it('CANCELLED has no outgoing edges — irreversibility is a table fact, not a guard', () => {
    expect(ORGANIZATION_STATUS_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it('every OrganizationStatus value has an explicit (possibly empty) edge list — no implicit fallthrough', () => {
    const keys = Object.keys(ORGANIZATION_STATUS_TRANSITIONS).sort();
    expect(keys).toEqual(['ACTIVE', 'CANCELLED', 'SUSPENDED']);
  });

  it('the same generic TransitionTable<S> shape backs the unchanged 4-value USER_TRANSITIONS', () => {
    expect(USER_TRANSITIONS).toEqual({
      ACTIVE: ['INACTIVE', 'SUSPENDED', 'DISABLED'],
      INACTIVE: ['ACTIVE', 'SUSPENDED', 'DISABLED'],
      SUSPENDED: ['ACTIVE', 'INACTIVE', 'DISABLED'],
      DISABLED: ['ACTIVE'],
    });
  });

  it('type-level: TransitionTable<S> parameterizes over any closed string union', () => {
    // Compile-time proof only — if this file compiles, the generic accepts
    // both OrganizationStatus (3-value) and LifecycleStatus (4-value).
    const orgTable: TransitionTable<OrganizationStatus> = ORGANIZATION_STATUS_TRANSITIONS;
    const userTable: TransitionTable<LifecycleStatus> = USER_TRANSITIONS;
    expect(orgTable).toBeDefined();
    expect(userTable).toBeDefined();
  });
});
