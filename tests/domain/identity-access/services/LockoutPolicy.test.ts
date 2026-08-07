import {
  MAX_LOGIN_ATTEMPTS,
  LOCKOUT_DURATION_MS,
  isLocked,
  registerFailure,
  registerSuccess,
} from '../../../../src/modules/identity-access/domain/services/LockoutPolicy.js';
import { INITIAL_LOCKOUT_STATE } from '../../../../src/modules/identity-access/domain/model/value-objects/LockoutState.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const T0 = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const T0_PLUS_59_MIN = fromDate(new Date('2026-01-01T00:59:00.000Z'));
const T0_PLUS_61_MIN = fromDate(new Date('2026-01-01T01:01:00.000Z'));

describe('LockoutPolicy constants (design D18)', () => {
  it('MAX_LOGIN_ATTEMPTS is 3', () => {
    expect(MAX_LOGIN_ATTEMPTS).toBe(3);
  });

  it('LOCKOUT_DURATION_MS is 1 hour', () => {
    expect(LOCKOUT_DURATION_MS).toBe(3_600_000);
  });
});

describe('registerFailure', () => {
  it('increments loginAttempts without locking on the 1st and 2nd failure', () => {
    const afterFirst = registerFailure(INITIAL_LOCKOUT_STATE, T0);
    expect(afterFirst).toEqual({ loginAttempts: 1, blockedUntil: null });

    const afterSecond = registerFailure(afterFirst, T0);
    expect(afterSecond).toEqual({ loginAttempts: 2, blockedUntil: null });
  });

  it('locks the account for 1h on the 3rd consecutive failure', () => {
    const twoFailures = { loginAttempts: 2, blockedUntil: null };

    const afterThird = registerFailure(twoFailures, T0);

    expect(afterThird.loginAttempts).toBe(3);
    expect(afterThird.blockedUntil).toBe(fromDate(new Date('2026-01-01T01:00:00.000Z')));
  });

  it('an EXPIRED lock resets loginAttempts to 0 before counting the new failure (design D18)', () => {
    const expiredLock = { loginAttempts: 3, blockedUntil: T0 };

    const afterFailure = registerFailure(expiredLock, T0_PLUS_61_MIN);

    expect(afterFailure).toEqual({ loginAttempts: 1, blockedUntil: null });
  });

  it('a lock that has NOT yet expired keeps counting on top of it (still locked)', () => {
    const activeLock = { loginAttempts: 3, blockedUntil: T0_PLUS_61_MIN };

    const afterFailure = registerFailure(activeLock, T0_PLUS_59_MIN);

    expect(afterFailure.loginAttempts).toBe(4);
    expect(afterFailure.blockedUntil).not.toBeNull();
  });
});

describe('registerSuccess', () => {
  it('resets loginAttempts to 0 and clears blockedUntil (account-lockout spec: "Success resets the counter")', () => {
    expect(registerSuccess()).toEqual({ loginAttempts: 0, blockedUntil: null });
  });
});

describe('isLocked', () => {
  it('is false for a never-locked account', () => {
    expect(isLocked(INITIAL_LOCKOUT_STATE, T0)).toBe(false);
  });

  it('is true while now is before blockedUntil', () => {
    const state = { loginAttempts: 3, blockedUntil: T0_PLUS_61_MIN };
    expect(isLocked(state, T0)).toBe(true);
  });

  it('is false once now has passed blockedUntil (expired lock reads as unlocked)', () => {
    const state = { loginAttempts: 3, blockedUntil: T0 };
    expect(isLocked(state, T0_PLUS_61_MIN)).toBe(false);
  });

  it('is false exactly AT blockedUntil (boundary is inclusive of expiry)', () => {
    const state = { loginAttempts: 3, blockedUntil: T0 };
    expect(isLocked(state, T0)).toBe(false);
  });
});
