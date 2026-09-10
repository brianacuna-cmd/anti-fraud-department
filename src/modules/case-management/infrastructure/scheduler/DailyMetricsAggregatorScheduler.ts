import type { Clock } from '../../../../shared/time/Clock.js';
import { SystemClock } from '../../../../shared/time/SystemClock.js';
import { toDate } from '../../../../shared/time/Instant.js';
import { msUntilNextMidnightBogota, type Sleeper } from '../../../screening/application/WalletSanctionsRescreenScheduler.js';

const defaultSleeper: Sleeper = (ms) =>
  new Promise((resolve) => { setTimeout(resolve, ms).unref(); });

/**
 * Fires `runAggregate` once daily at 00:00 America/Bogota, targeting the
 * previous full Bogota day (design #645, MET-003 PR4). Same
 * `WalletSanctionsRescreenScheduler`/`SlaSweepScheduler` sleeper-loop idiom:
 * injectable `Sleeper` + `stop()` + `onError`.
 */
export function createDailyMetricsAggregatorScheduler(deps: {
  readonly runAggregate: () => Promise<unknown>;
  readonly clock?: Clock;
  readonly sleeper?: Sleeper;
  readonly onError?: (error: unknown) => void;
}): { start(): void; stop(): void; run(): Promise<void> } {
  const clock = deps.clock ?? new SystemClock();
  const sleeper = deps.sleeper ?? defaultSleeper;
  const onError = deps.onError ?? ((e: unknown) => console.error('[daily-fraud-metrics] error:', e));

  let inFlight: Promise<void> | null = null;
  let stopped = false;

  function run(): Promise<void> {
    if (inFlight !== null) return inFlight;
    inFlight = (async () => {
      try {
        await deps.runAggregate();
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
        try {
          await sleeper(msUntilNextMidnightBogota(toDate(clock.now())));
          if (stopped) break;
          await run();
        } catch (error) {
          // A throwing clock/sleeper (not just runAggregate, which run() already
          // guards) must not escape as an unhandled rejection that silently kills
          // the loop — report and keep the nightly cadence alive.
          onError(error);
        }
      }
    })();
  }

  return { start, stop: () => { stopped = true; }, run };
}
