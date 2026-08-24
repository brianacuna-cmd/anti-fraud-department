import type { TransitionTable } from './transitions.js';
import { invalidTransition } from '../errors/ScreeningError.js';

/**
 * Table-driven transition guard (mirrors case-management's
 * `StatusTransitionPolicy`) — `AmlAlert` has no actor-gated edge, so there is
 * no reactivation/actor parameter here.
 */
export function assertTransitionAllowed<S extends string>(
  table: TransitionTable<S>,
  current: S,
  next: S,
): void {
  if (!table[current].includes(next)) {
    throw invalidTransition(current, next);
  }
}
