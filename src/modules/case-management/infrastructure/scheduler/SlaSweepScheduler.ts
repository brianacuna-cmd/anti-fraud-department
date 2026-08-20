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
 * MULTI-INSTANCE SAFE (PR6): running several instances of this scheduler
 * is safe. Each instance still runs its own poll loop, but the underlying
 * `SweepSlaTracking` use case claims due rows through
 * `CaseSlaTrackingRepository.claimDueForSweep`, an exclusive per-row lease
 * (5-minute TTL) mirroring the outbox `claimPending`. Two instances never
 * claim the same row in the same window, and `markNotified` per-status
 * idempotency covers the rare lease-expiry overlap. No external lock needed.
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
