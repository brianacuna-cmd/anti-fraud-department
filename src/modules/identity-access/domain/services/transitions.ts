import type { LifecycleStatus } from '../model/value-objects/LifecycleStatus.js';

/**
 * Lookup table shape shared by every entity's transition table (design D9).
 * `StatusTransitionPolicy` consumes this — never an if/switch cascade.
 */
export type TransitionTable = Readonly<Record<LifecycleStatus, readonly LifecycleStatus[]>>;

/**
 * Organization status edges (organization-lifecycle spec: "Organization
 * Status Transition Matrix"). `DESHABILITADO` is a cul-de-sac except for
 * `ACTIVO` reactivation, which is further actor-gated by
 * `StatusTransitionPolicy` (platform-admin only).
 */
export const ORGANIZATION_TRANSITIONS: TransitionTable = {
  ACTIVO: ['INACTIVO', 'SUSPENDIDO', 'DESHABILITADO'],
  INACTIVO: ['ACTIVO', 'SUSPENDIDO', 'DESHABILITADO'],
  SUSPENDIDO: ['ACTIVO', 'INACTIVO', 'DESHABILITADO'],
  DESHABILITADO: ['ACTIVO'],
};

/**
 * User status edges (user-lifecycle spec: "User Status Transition Matrix").
 * Identical shape to `ORGANIZATION_TRANSITIONS` (design D9: same value set,
 * distinct table). Reactivation is gated the same way by
 * `StatusTransitionPolicy`: an org-admin — even on a user in their own org —
 * gets `FORBIDDEN_REACTIVATION`, never a silent success.
 */
export const USER_TRANSITIONS: TransitionTable = {
  ACTIVO: ['INACTIVO', 'SUSPENDIDO', 'DESHABILITADO'],
  INACTIVO: ['ACTIVO', 'SUSPENDIDO', 'DESHABILITADO'],
  SUSPENDIDO: ['ACTIVO', 'INACTIVO', 'DESHABILITADO'],
  DESHABILITADO: ['ACTIVO'],
};
