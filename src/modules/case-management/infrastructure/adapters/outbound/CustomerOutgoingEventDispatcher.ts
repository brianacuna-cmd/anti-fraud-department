import type { Clock } from '../../../../../shared/time/Clock.js';
import type { CustomerOutgoingEventRepository } from '../../../domain/ports/CustomerOutgoingEventRepository.js';
import type { OutgoingWebhookClient } from '../../../domain/ports/OutgoingWebhookClient.js';

export type Sleeper = (ms: number) => Promise<void>;

export interface CustomerOutgoingEventDispatcherDeps {
  readonly outgoingEvents: CustomerOutgoingEventRepository;
  readonly webhookClient: OutgoingWebhookClient;
  readonly clock: Clock;
  /** Injectable delay used by `start()` between poll ticks (tests: FakeSleeper). */
  readonly sleeper?: Sleeper;
  readonly claimLimit?: number;
  readonly onError?: (error: unknown) => void;
}

export interface DispatchOnceResult {
  readonly processed: number;
  readonly sent: number;
  readonly failed: number;
}

export interface DispatcherHandle {
  stop(): void;
}

const DEFAULT_CLAIM_LIMIT = 50;

const defaultSleeper: Sleeper = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Polls `customer_outgoing_events` PENDING rows, POSTs via `OutgoingWebhookClient`,
 * and marks SENT (2xx) or records failures until FAILED at attempt 5.
 * Backoff between attempts is enforced by `claimPending` (1s,2s,4s,8s,16s schedule).
 */
export function createCustomerOutgoingEventDispatcher(deps: CustomerOutgoingEventDispatcherDeps) {
  const claimLimit = deps.claimLimit ?? DEFAULT_CLAIM_LIMIT;
  const sleeper = deps.sleeper ?? defaultSleeper;
  const onError = deps.onError ?? ((error: unknown) => {
    console.error('CustomerOutgoingEventDispatcher error:', error);
  });

  async function dispatchOnce(): Promise<DispatchOnceResult> {
    const now = deps.clock.now();
    const claimed = await deps.outgoingEvents.claimPending(now, claimLimit);
    let sent = 0;
    let failed = 0;

    for (const event of claimed) {
      let responseStatus = 0;
      let ok = false;
      try {
        const result = await deps.webhookClient.post({
          url: event.webhookUrl,
          payload: { ...event.payload },
        });
        responseStatus = result.statusCode;
        ok = result.ok;
      } catch {
        responseStatus = 0;
        ok = false;
      }

      if (ok) {
        const updated = event.markSent({ responseStatus, now: deps.clock.now() });
        await deps.outgoingEvents.save(updated);
        sent += 1;
      } else {
        const updated = event.recordFailure({ responseStatus, now: deps.clock.now() });
        await deps.outgoingEvents.save(updated);
        if (updated.status === 'FAILED') {
          failed += 1;
        }
      }
    }

    return { processed: claimed.length, sent, failed };
  }

  function start(intervalMs: number): DispatcherHandle {
    let stopped = false;
    const run = async (): Promise<void> => {
      while (!stopped) {
        try {
          await dispatchOnce();
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

  return { dispatchOnce, start };
}
