import type { Clock } from '../../../shared/time/Clock.js';
import { SystemClock } from '../../../shared/time/SystemClock.js';
import { toDate } from '../../../shared/time/Instant.js';
import type { Sleeper } from './WalletSanctionsRescreenScheduler.js';
import { msUntilNextMidnightBogota } from './WalletSanctionsRescreenScheduler.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** ms until the next `hour:minute` America/Bogota; 0 when it is exactly that time. */
export function msUntilNextBogotaTime(now: Date, hour: number, minute = 0): number {
  const untilMidnight = msUntilNextMidnightBogota(now);
  const sinceMidnight = untilMidnight === 0 ? 0 : DAY_MS - untilMidnight;
  const target = (hour * 60 + minute) * 60 * 1000;
  const wait = target - sinceMidnight;
  return wait < 0 ? wait + DAY_MS : wait;
}

const defaultSleeper: Sleeper = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });

/**
 * Runs `run` once a day at `hour:minute` America/Bogota — the wallet
 * rescreen scheduler's sleeper loop, with the time of day as a parameter.
 *
 * The time matters: the sanctions sync runs at 23:00 so the wallet rescreen
 * (00:00) and the customer rescreen (01:00) screen against lists refreshed
 * that same night instead of the previous day's.
 */
export function createDailyBogotaScheduler(deps: {
  readonly run: () => Promise<unknown>;
  readonly hour: number;
  readonly minute?: number;
  readonly label: string;
  readonly clock?: Clock;
  readonly sleeper?: Sleeper;
  readonly onError?: (error: unknown) => void;
}): { start(): void; stop(): void; run(): Promise<void> } {
  const clock = deps.clock ?? new SystemClock();
  const sleeper = deps.sleeper ?? defaultSleeper;
  const onError = deps.onError ?? ((error: unknown) => console.error(`[${deps.label}] error:`, error));

  let inFlight: Promise<void> | null = null;
  let stopped = false;

  function run(): Promise<void> {
    if (inFlight !== null) return inFlight;
    inFlight = (async () => {
      try {
        await deps.run();
      } catch (error) {
        onError(error);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  function start(): void {
    stopped = false;
    void (async () => {
      while (!stopped) {
        await sleeper(msUntilNextBogotaTime(toDate(clock.now()), deps.hour, deps.minute));
        if (stopped) break;
        await run();
      }
    })();
  }

  return { start, stop: () => { stopped = true; }, run };
}
