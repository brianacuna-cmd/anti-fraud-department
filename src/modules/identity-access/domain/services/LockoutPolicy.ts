import type { Instant } from '../../../../shared/time/Instant.js';
import { fromDate, toDate } from '../../../../shared/time/Instant.js';
import type { LockoutState } from '../model/value-objects/LockoutState.js';

/** 3rd consecutive failure locks the account (design D18, account-lockout spec). */
export const MAX_LOGIN_ATTEMPTS = 3;

/** 1 hour, in milliseconds (design D18). */
export const LOCKOUT_DURATION_MS = 3_600_000;

function isExpired(blockedUntil: Instant | null, now: Instant): boolean {
  return blockedUntil !== null && toDate(blockedUntil).getTime() <= toDate(now).getTime();
}

/**
 * Pure shared domain service over `LockoutState` (design D18) — no
 * repository, no I/O. `AuthenticateActor` reads/writes the returned state
 * through `ActorCredentialGateway`; this module never touches persistence.
 */

/** True only while the account is inside an ACTIVE (non-expired) block. */
export function isLocked(state: LockoutState, now: Instant): boolean {
  return state.blockedUntil !== null && !isExpired(state.blockedUntil, now);
}

/**
 * Registers one failed password check. An EXPIRED lock resets to zero
 * failures BEFORE this failure is counted (design D18: "An expired lock
 * resets before the new failure is counted") — a stale block never inflates
 * the next lockout countdown.
 */
export function registerFailure(state: LockoutState, now: Instant): LockoutState {
  const baseline: LockoutState = isExpired(state.blockedUntil, now)
    ? { loginAttempts: 0, blockedUntil: null }
    : state;
  const loginAttempts = baseline.loginAttempts + 1;

  if (loginAttempts >= MAX_LOGIN_ATTEMPTS) {
    return { loginAttempts, blockedUntil: fromDate(new Date(toDate(now).getTime() + LOCKOUT_DURATION_MS)) };
  }
  return { loginAttempts, blockedUntil: baseline.blockedUntil };
}

/** A successful login always resets the counter (account-lockout spec: "Success resets the counter"). */
export function registerSuccess(): LockoutState {
  return { loginAttempts: 0, blockedUntil: null };
}
