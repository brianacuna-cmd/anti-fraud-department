import {
  computeRetryAt,
  createOutboxRetryPolicy,
  type OutboxRetryPolicy,
} from '../../../../src/shared/outbox/OutboxRetryPolicy.js';
import { fromDate, toDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-11-02T08:00:00.000Z'));
const DEFAULT_POLICY: OutboxRetryPolicy = {
  maxAttempts: 5,
  backoffScheduleSeconds: [30, 60, 120, 300, 600],
};

describe('createOutboxRetryPolicy', () => {
  it('uses defaults when env vars are absent', () => {
    const policy = createOutboxRetryPolicy({});

    expect(policy.maxAttempts).toBe(5);
    expect(policy.backoffScheduleSeconds).toEqual([30, 60, 120, 300, 600]);
  });

  it('parses custom OUTBOX_MAX_ATTEMPTS and OUTBOX_BACKOFF_SCHEDULE_SECONDS', () => {
    const policy = createOutboxRetryPolicy({
      OUTBOX_MAX_ATTEMPTS: '3',
      OUTBOX_BACKOFF_SCHEDULE_SECONDS: '10,20,30',
    });

    expect(policy.maxAttempts).toBe(3);
    expect(policy.backoffScheduleSeconds).toEqual([10, 20, 30]);
  });

  it('throws when schedule length !== maxAttempts', () => {
    expect(() =>
      createOutboxRetryPolicy({
        OUTBOX_MAX_ATTEMPTS: '3',
        OUTBOX_BACKOFF_SCHEDULE_SECONDS: '10,20',
      }),
    ).toThrow();
  });

  it('throws when default schedule length !== custom maxAttempts', () => {
    expect(() =>
      createOutboxRetryPolicy({ OUTBOX_MAX_ATTEMPTS: '3' }),
    ).toThrow();
  });

  it('throws on a non-numeric schedule entry', () => {
    expect(() =>
      createOutboxRetryPolicy({
        OUTBOX_BACKOFF_SCHEDULE_SECONDS: '30,abc,120,300,600',
      }),
    ).toThrow();
  });

  it('throws on a zero entry in the schedule', () => {
    expect(() =>
      createOutboxRetryPolicy({
        OUTBOX_BACKOFF_SCHEDULE_SECONDS: '30,0,120,300,600',
      }),
    ).toThrow();
  });

  it('throws on a negative entry in the schedule', () => {
    expect(() =>
      createOutboxRetryPolicy({
        OUTBOX_BACKOFF_SCHEDULE_SECONDS: '30,-5,120,300,600',
      }),
    ).toThrow();
  });
});

describe('computeRetryAt', () => {
  it('returns now + base seconds when rng returns 1.0', () => {
    // attemptsAfter=1 → schedule[0]=30s
    const result = computeRetryAt(DEFAULT_POLICY, 1, NOW, () => 1);
    const expectedMs = toDate(NOW).getTime() + 30 * 1000;

    expect(toDate(result).getTime()).toBe(expectedMs);
  });

  it('returns now when rng returns 0 (jitter floor)', () => {
    const result = computeRetryAt(DEFAULT_POLICY, 1, NOW, () => 0);

    expect(result).toBe(NOW);
  });

  it('uses the correct base for each attempt index', () => {
    const schedule = [30, 60, 120, 300, 600];
    for (let i = 0; i < schedule.length; i++) {
      const attemptsAfter = i + 1;
      const result = computeRetryAt(DEFAULT_POLICY, attemptsAfter, NOW, () => 1);
      const expectedMs = toDate(NOW).getTime() + schedule[i] * 1000;

      expect(toDate(result).getTime()).toBe(expectedMs);
    }
  });

  it('clamps to last schedule entry for attempts beyond schedule length', () => {
    // attemptsAfter=10 → clamp to schedule[4]=600
    const result = computeRetryAt(DEFAULT_POLICY, 10, NOW, () => 1);
    const expectedMs = toDate(NOW).getTime() + 600 * 1000;

    expect(toDate(result).getTime()).toBe(expectedMs);
  });

  it('delay falls within [0, base * 1000ms] for a mid-range rng value', () => {
    const rng = () => 0.5;
    const baseMs = 30 * 1000;
    const result = computeRetryAt(DEFAULT_POLICY, 1, NOW, rng);
    const nowMs = toDate(NOW).getTime();
    const resultMs = toDate(result).getTime();

    expect(resultMs).toBeGreaterThanOrEqual(nowMs);
    expect(resultMs).toBeLessThanOrEqual(nowMs + baseMs);
  });
});
