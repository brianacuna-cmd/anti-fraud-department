import type { SlaSchedulerHandle } from '../../domain/ports/SlaScheduler.js';
import type { SweepSlaTrackingResult } from '../../application/SweepSlaTracking.js';

export type Sleeper = (ms: number) => Promise<void>;

export interface SlaSweepSchedulerDeps {
  readonly sweepSlaTracking: () => Promise<SweepSlaTrackingResult>;
  /** Injectable delay used by `start()` between sweep ticks (tests: FakeSleeper). */
  readonly sleeper?: Sleeper;
  readonly onError?: (error: unknown) => void;
}

const defaultSleeper: Sleeper = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Background driver for `SweepSlaTracking` (Slice 13, ADR-D7). Copies the
 * self-rolled poll loop already proven by `CustomerOutgoingEventDispatcher`
 * (injectable `Sleeper`, `stop()` handle, `onError` hook) instead of adding
 * `node-cron` as a new dependency — a fixed-interval single-process loop is
 * all this needs, and the repo already ships a tested idiom for it.
 *
 * SINGLE-INSTANCE CAVEAT (spec: "Single-instance scheduler caveat", A3):
 * this scheduler assumes exactly one running instance. If the process is
 * horizontally scaled (multiple instances), EACH instance runs its own
 * independent sweep loop and they will race to process the SAME due rows —
 * the sweep can double-run across instances. The ONLY safeguard in this
 * change is `CaseSlaTracking.markNotified` idempotency (a second sweep of
 * an already-notified row re-applies the same, safe, status advance and
 * skips re-sending the notification) — there is NO distributed lock. Do
 * not deploy multiple instances of this scheduler without adding one.
 */
export function createSlaSweepScheduler(deps: SlaSweepSchedulerDeps) {
  const sleeper = deps.sleeper ?? defaultSleeper;
  const onError =
    deps.onError ??
    ((error: unknown) => {
      console.error('SlaSweepScheduler error:', error);
    });

  function start(intervalMs: number): SlaSchedulerHandle {
    let stopped = false;
    const run = async (): Promise<void> => {
      while (!stopped) {
        try {
          await deps.sweepSlaTracking();
        } catch (error) {
          onError(error);
        }
        if (stopped) {
          break;
        }
        await sleeper(intervalMs);
      }
    };
    void run();
    return {
      stop(): void {
        stopped = true;
      },
    };
  }

  return { start };
}
