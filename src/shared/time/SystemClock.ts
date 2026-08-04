import type { Clock } from './Clock.js';
import { fromDate, type Instant } from './Instant.js';

/**
 * The only `Clock` implementation allowed to touch the real wall clock.
 * Everything else (domain, application, tests) takes a `Clock` and can
 * substitute a fake.
 */
export class SystemClock implements Clock {
  now(): Instant {
    return fromDate(new Date());
  }
}
