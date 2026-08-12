import type { TransitionTable } from './transitions.js';
import { invalidTransition } from '../errors/CaseManagementError.js';

/**
 * Table-driven transition guard (mirrors identity-access's
 * `StatusTransitionPolicy`, simplified: `Case` has no actor-gated edge, so
 * there is no `reactivationEdge`/`TransitionActor` parameter here).
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
