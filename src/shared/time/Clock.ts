import type { Instant } from './Instant.js';

/**
 * Port for "now". Domain services take a `Clock` (or a resolved `Instant`)
 * instead of calling `new Date()`/`Date.now()` directly, per §25.1: domain
 * stays pure and testable with a fake clock.
 */
export interface Clock {
  now(): Instant;
}
