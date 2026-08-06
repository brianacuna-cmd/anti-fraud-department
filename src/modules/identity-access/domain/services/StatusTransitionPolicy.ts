import type { TransitionActor } from '../model/value-objects/TransitionActor.js';
import type { TransitionTable } from './transitions.js';
import { invalidTransition, forbiddenReactivation } from '../errors/IdentityAccessError.js';

/**
 * A single actor-gated edge within a `TransitionTable<S>` (design D10: "the
 * reactivation gate takes an optional `reactivationEdge`"). When present,
 * that one edge additionally requires `actor.isPlatformAdmin`, even though
 * the table already marks it matrix-valid. Absent for `Organization`
 * (design D10: `CANCELLED: []` alone makes irreversibility hold for every
 * actor — no edge needs extra gating), present for `User` (`DISABLED ->
 * ACTIVE`, unchanged from design D9).
 */
export interface ReactivationEdge<S extends string> {
  readonly from: S;
  readonly to: S;
}

/**
 * Table-driven transition guard shared by organizations and users (design
 * D2, D9, generalized by D10). Table lookup decides matrix validity;
 * `reactivationEdge`, when given, additionally gates that one edge on
 * `actor.isPlatformAdmin` — the transition itself can be matrix-valid yet
 * still forbidden for this actor.
 */
export function assertTransitionAllowed<S extends string>(
  table: TransitionTable<S>,
  current: S,
  next: S,
  actor: TransitionActor,
  reactivationEdge?: ReactivationEdge<S>,
): void {
  if (!table[current].includes(next)) {
    throw invalidTransition(current, next);
  }
  if (!reactivationEdge || !isReactivation(current, next, reactivationEdge)) {
    return;
  }
  if (actor.isPlatformAdmin) {
    return;
  }
  throw forbiddenReactivation(current, next);
}

function isReactivation<S extends string>(current: S, next: S, edge: ReactivationEdge<S>): boolean {
  return current === edge.from && next === edge.to;
}
