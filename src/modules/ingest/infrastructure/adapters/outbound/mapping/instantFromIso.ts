import { fromDate } from '../../../../../../shared/time/Instant.js';
import type { Instant } from '../../../../../../shared/time/Instant.js';

export function instantFromIso(value: unknown): Instant {
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return fromDate(date);
    }
  }
  return fromDate(new Date(0));
}
