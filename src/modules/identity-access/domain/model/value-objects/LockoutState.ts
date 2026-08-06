import type { Instant } from '../../../../../shared/time/Instant.js';

/**
 * Persistence/domain-only failed-login tracking shared by Users AND
 * Organizations (design D18) — the whole point of `LockoutPolicy` being a
 * shared domain service is that this shape is identical across both tiers.
 * A plain embedded VO, not a branded id: there is nothing to validate at
 * construction, only the pure transition rules `LockoutPolicy` owns.
 */
export interface LockoutState {
  readonly loginAttempts: number;
  readonly blockedUntil: Instant | null;
}

/** The state every new account starts in — never locked, zero failures. */
export const INITIAL_LOCKOUT_STATE: LockoutState = { loginAttempts: 0, blockedUntil: null };
