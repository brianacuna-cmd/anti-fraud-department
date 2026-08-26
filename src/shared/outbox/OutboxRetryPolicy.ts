import type { Instant } from '../time/Instant.js';
import { fromDate, toDate } from '../time/Instant.js';
import { outboxInvariant } from './OutboxError.js';

export interface OutboxRetryPolicy {
  readonly maxAttempts: number;
  readonly backoffScheduleSeconds: readonly number[];
}

/**
 * Parses `OutboxRetryPolicy` from environment variables. Throws at boot if
 * the configuration is invalid so a misconfigured deployment fails fast
 * rather than silently at the first Kafka outage.
 *
 * Env vars:
 *   OUTBOX_MAX_ATTEMPTS              — default 5, integer >= 1
 *   OUTBOX_BACKOFF_SCHEDULE_SECONDS  — default "30,60,120,300,600",
 *                                      comma-separated, each entry finite > 0,
 *                                      length must equal maxAttempts
 */
export function createOutboxRetryPolicy(env: NodeJS.ProcessEnv): OutboxRetryPolicy {
  const maxAttempts =
    env.OUTBOX_MAX_ATTEMPTS !== undefined
      ? parsePositiveInt('OUTBOX_MAX_ATTEMPTS', env.OUTBOX_MAX_ATTEMPTS)
      : 5;

  const scheduleRaw = env.OUTBOX_BACKOFF_SCHEDULE_SECONDS ?? '30,60,120,300,600';
  const backoffScheduleSeconds = scheduleRaw.split(',').map((raw, i) => {
    const n = Number(raw.trim());
    if (!isFinite(n) || n <= 0) {
      throw outboxInvariant(
        `OUTBOX_BACKOFF_SCHEDULE_SECONDS[${i}] must be a positive finite number`,
        { value: raw.trim() },
      );
    }
    return n;
  });

  if (backoffScheduleSeconds.length !== maxAttempts) {
    throw outboxInvariant(
      `OUTBOX_BACKOFF_SCHEDULE_SECONDS length (${backoffScheduleSeconds.length}) must equal OUTBOX_MAX_ATTEMPTS (${maxAttempts})`,
      { length: backoffScheduleSeconds.length, maxAttempts },
    );
  }

  return { maxAttempts, backoffScheduleSeconds };
}

/**
 * Computes a jittered next-retry instant using full jitter:
 *   delay = rng() * backoffScheduleSeconds[min(attemptsAfter-1, last)] * 1_000 ms
 *
 * @param policy      — the retry policy
 * @param attemptsAfter — event.publishAttempts + 1 (1-based index of this failure)
 * @param now         — current instant
 * @param rng         — injected random number generator (0 ≤ rng() ≤ 1)
 */
export function computeRetryAt(
  policy: OutboxRetryPolicy,
  attemptsAfter: number,
  now: Instant,
  rng: () => number,
): Instant {
  const index = Math.min(attemptsAfter - 1, policy.backoffScheduleSeconds.length - 1);
  const baseSeconds = policy.backoffScheduleSeconds[index];
  const delayMs = rng() * baseSeconds * 1000;
  return fromDate(new Date(toDate(now).getTime() + delayMs));
}

function parsePositiveInt(name: string, raw: string): number {
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) {
    throw outboxInvariant(`${name} must be a positive integer`, { value: raw });
  }
  return n;
}
