import { SystemClock } from '../../../src/shared/time/SystemClock.js';

describe('SystemClock', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns strictly increasing Instant values as real time advances', () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const clock = new SystemClock();

    const first = clock.now();
    jest.advanceTimersByTime(5);
    const second = clock.now();

    expect(second > first).toBe(true);
    expect(String(first)).toBe('2024-01-01T00:00:00.000Z');
    expect(String(second)).toBe('2024-01-01T00:00:00.005Z');
  });
});
