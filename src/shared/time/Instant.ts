import { brand, type Brand } from '../kernel/Brand.js';

/**
 * A UTC timestamp represented as an ISO-8601 string, branded so it can never
 * be confused with an arbitrary `string` at compile time. Not a `Date`
 * (mutable, per ESTRUCTURA_REPO.md §2) — conversion helpers below are the
 * only supported way in/out.
 */
export type Instant = Brand<string, 'Instant'>;

export function fromDate(date: Date): Instant {
  return brand<string, 'Instant'>(date.toISOString());
}

export function toDate(instant: Instant): Date {
  return new Date(instant);
}
