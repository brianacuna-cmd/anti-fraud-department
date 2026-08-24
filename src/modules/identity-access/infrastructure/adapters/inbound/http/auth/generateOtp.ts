import { randomInt } from 'node:crypto';

const OTP_MIN = 100_000;
/** Exclusive upper bound for `randomInt` — yields 100000..999999. */
const OTP_MAX_EXCLUSIVE = 1_000_000;

/**
 * Six-digit one-time code for the e-mail step of a login challenge.
 *
 * Uses `randomInt` (CSPRNG), never `Math.random`: these codes are an
 * authentication factor, and `Math.random` is a seeded PRNG whose future
 * outputs an attacker can predict after observing a handful of them — one
 * OTP arriving in an attacker-controlled inbox would be enough to start
 * guessing someone else's. Lives here, shared by the organization and
 * super-admin routers, so the two challenge flows cannot drift apart.
 */
export function generateOtp(): string {
  return String(randomInt(OTP_MIN, OTP_MAX_EXCLUSIVE));
}
