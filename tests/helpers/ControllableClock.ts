import type { Clock } from '../../src/shared/time/Clock.js';
import { fromDate, toDate, type Instant } from '../../src/shared/time/Instant.js';

/** Mutable `Clock` fake — tests advance time without waiting. */
export class ControllableClock implements Clock {
  private current: Instant;

  constructor(initial: Instant) {
    this.current = initial;
  }

  now(): Instant {
    return this.current;
  }

  advanceBySeconds(seconds: number): Instant {
    const next = new Date(toDate(this.current).getTime() + seconds * 1000);
    this.current = fromDate(next);
    return this.current;
  }

  set(instant: Instant): void {
    this.current = instant;
  }
}
