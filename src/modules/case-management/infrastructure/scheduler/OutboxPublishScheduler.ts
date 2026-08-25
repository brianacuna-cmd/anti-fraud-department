import type { PublishOutboxEventsResult } from '../../application/PublishOutboxEvents.js';

export type Sleeper = (ms: number) => Promise<void>;

export interface OutboxPublishSchedulerDeps {
  readonly publishOutboxEvents: () => Promise<PublishOutboxEventsResult>;
  /** Injectable delay between ticks (in tests: FakeSleeper). */
  readonly sleeper?: Sleeper;
  readonly onError?: (error: unknown) => void;
}

export interface OutboxPublishSchedulerHandle {
  stop(): void;
}

const defaultSleeper: Sleeper = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Background driver for `PublishOutboxEvents`.
 *
 * Copies the same polling loop as `SlaSweepScheduler` and
 * `CustomerOutgoingEventDispatcher` —injectable `Sleeper`, `stop()`, `onError`—
 * instead of introducing a cron dependency: a fixed interval in a single
 * process is all that is needed, and the repository already has that idiom
 * proven.
 *
 * MULTI-INSTANCE WARNING: unlike the SLA sweep, `findPending` does not claim
 * rows exclusively, so two instances can publish the same event. Delivery is
 * already "at least once" by design and consumers have to be idempotent, but
 * it is wise to run a single instance until the repository offers an atomic
 * `claim`.
 */
export function createOutboxPublishScheduler(deps: OutboxPublishSchedulerDeps) {
  const sleeper = deps.sleeper ?? defaultSleeper;
  const onError =
    deps.onError ??
    ((error: unknown) => {
      console.error('OutboxPublishScheduler error:', error);
    });

  function start(intervalMs: number): OutboxPublishSchedulerHandle {
    let stopped = false;
    const run = async (): Promise<void> => {
      while (!stopped) {
        try {
          await deps.publishOutboxEvents();
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
