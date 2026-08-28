import type { TransitionTable } from './transitions.js';
import { invalidTransition } from '../errors/SarError.js';

/** Table-driven transition guard (mirrors case-management's `StatusTransitionPolicy`). */
export function assertTransitionAllowed<S extends string>(
  table: TransitionTable<S>,
  current: S,
  next: S,
): void {
  if (!table[current].includes(next)) {
    throw invalidTransition(current, next);
  }
}
