import type { LifecycleStatus } from '../model/value-objects/LifecycleStatus.js';
import type { TransitionActor } from '../model/value-objects/TransitionActor.js';
import type { TransitionTable } from './transitions.js';
import { invalidTransition, forbiddenReactivation } from '../errors/IdentityAccessError.js';

const REACTIVATION_FROM: LifecycleStatus = 'DISABLED';
const REACTIVATION_TO: LifecycleStatus = 'ACTIVE';

/**
 * Table-driven transition guard shared by organizations and users (design
 * D2, D9). Table lookup decides matrix validity; `actor.isPlatformAdmin`
 * additionally gates the single reactivation edge — the transition itself
 * can be matrix-valid yet still forbidden for this actor.
 */
export function assertTransitionAllowed(
  table: TransitionTable,
  current: LifecycleStatus,
  next: LifecycleStatus,
  actor: TransitionActor,
): void {
  if (!table[current].includes(next)) {
    throw invalidTransition(current, next);
  }
  if (!isReactivation(current, next)) {
    return;
  }
  if (actor.isPlatformAdmin) {
    return;
  }
  throw forbiddenReactivation(current, next);
}

function isReactivation(current: LifecycleStatus, next: LifecycleStatus): boolean {
  return current === REACTIVATION_FROM && next === REACTIVATION_TO;
}
