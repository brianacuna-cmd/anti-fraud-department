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
