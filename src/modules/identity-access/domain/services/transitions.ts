import type { LifecycleStatus } from '../model/value-objects/LifecycleStatus.js';
import type { OrganizationStatus } from '../model/value-objects/OrganizationStatus.js';

/**
 * Lookup table shape shared by every entity's transition table (design D2,
 * generalized by D10 — `Organization` and `User` no longer share one
 * concrete status union, but both consume the SAME generic shape).
 * `StatusTransitionPolicy` consumes this — never an if/switch cascade.
 */
export type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;

/**
 * Organization status edges (organization-lifecycle spec: "Organization
 * Status Transition Matrix", design D10 — supersedes D9). `CANCELLED` has
 * NO outgoing edges: irreversibility is a table fact, true for every actor,
 * with no extra actor-gating needed (unlike `USER_TRANSITIONS`'s
 * reactivation edge).
 */
export const ORGANIZATION_STATUS_TRANSITIONS: TransitionTable<OrganizationStatus> = {
  ACTIVE: ['SUSPENDED', 'CANCELLED'],
  SUSPENDED: ['ACTIVE', 'CANCELLED'],
  CANCELLED: [],
};

/**
 * User status edges (user-lifecycle spec: "User Status Transition Matrix").
 * Unchanged 4-value shape (design D10: `LifecycleStatus` stays Users-only).
 * Reactivation is gated by `StatusTransitionPolicy` via an explicit
 * `reactivationEdge` passed at the call site (`User.transitionTo`): an
 * org-admin — even on a user in their own org — gets
 * `FORBIDDEN_REACTIVATION`, never a silent success.
 */
export const USER_TRANSITIONS: TransitionTable<LifecycleStatus> = {
  ACTIVE: ['INACTIVE', 'SUSPENDED', 'DISABLED'],
  INACTIVE: ['ACTIVE', 'SUSPENDED', 'DISABLED'],
  SUSPENDED: ['ACTIVE', 'INACTIVE', 'DISABLED'],
  DISABLED: ['ACTIVE'],
};
