import type { Clock } from '../../src/shared/time/Clock.js';
import type { Instant } from '../../src/shared/time/Instant.js';

/** Deterministic `Clock` fake for unit tests — always returns the same `Instant`. */
export class FixedClock implements Clock {
  constructor(private readonly instant: Instant) {}

  now(): Instant {
    return this.instant;
  }
}
