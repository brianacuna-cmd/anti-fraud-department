import { fromDate, toDate, type Instant } from '../../../src/shared/time/Instant.js';

describe('Instant', () => {
  it('round-trips a Date through fromDate/toDate without losing precision', () => {
    const date = new Date('2024-03-15T10:30:00.123Z');

    const instant: Instant = fromDate(date);
    const back = toDate(instant);

    expect(back.toISOString()).toBe('2024-03-15T10:30:00.123Z');
  });

  it('produces an ISO-8601 UTC string representation', () => {
    const instant = fromDate(new Date('2024-01-01T00:00:00.000Z'));

    expect(String(instant)).toBe('2024-01-01T00:00:00.000Z');
  });
});
