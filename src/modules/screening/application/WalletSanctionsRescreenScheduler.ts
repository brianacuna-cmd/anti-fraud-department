import type { Clock } from '../../../shared/time/Clock.js';
import { SystemClock } from '../../../shared/time/SystemClock.js';
import { toDate } from '../../../shared/time/Instant.js';

export type Sleeper = (ms: number) => Promise<void>;

/** ms until 00:00 America/Bogota; 0 if already exactly midnight. Colombia has no DST. */
export function msUntilNextMidnightBogota(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const todayMidnight = new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00-05:00`);
  const msSinceMidnight = now.getTime() - todayMidnight.getTime();
  if (msSinceMidnight === 0) return 0;
  return 24 * 60 * 60 * 1000 - msSinceMidnight;
}

const defaultSleeper: Sleeper = (ms) =>
  new Promise((resolve) => { setTimeout(resolve, ms).unref(); });

/**
 * Fires `runRescreen` once daily at 00:00 America/Bogota.
 * SlaSweepScheduler sleeper-loop idiom: injectable Sleeper + stop() + onError.
 * Authorized deviation from design D6 (setInterval + initialDelay):
 * sleeper-until-midnight per Engram #196.
 */
export function createWalletSanctionsRescreenScheduler(deps: {
  readonly runRescreen: () => Promise<void>;
  readonly clock?: Clock;
  readonly sleeper?: Sleeper;
  readonly onError?: (error: unknown) => void;
}): { start(): void; stop(): void; run(): Promise<void> } {
  const clock = deps.clock ?? new SystemClock();
  const sleeper = deps.sleeper ?? defaultSleeper;
  const onError = deps.onError ?? ((e: unknown) => console.error('[wallet-rescreen] error:', e));

  let inFlight: Promise<void> | null = null;
  let stopped = false;

  function run(): Promise<void> {
    if (inFlight !== null) return inFlight;
    inFlight = (async () => {
      try {
        await deps.runRescreen();
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
        await sleeper(msUntilNextMidnightBogota(toDate(clock.now())));
        if (stopped) break;
        await run();
      }
    })();
  }

  return { start, stop: () => { stopped = true; }, run };
}
