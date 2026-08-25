import type { Clock } from '../../../shared/time/Clock.js';
import type { OutboxEventRelayRepository } from '../../../shared/outbox/OutboxEventRelayRepository.js';
import type { OutboxEvent } from '../../../shared/outbox/OutboxEvent.js';

/**
 * Destination of an already committed event.
 *
 * Declared as a port rather than a concrete HTTP call because as of today
 * there is no decided consumer: leaving it abstract lets us dispatch to a
 * log while deciding, and switch to a queue or a webhook without touching
 * the publisher.
 */
export interface OutboxPublisher {
  publish(event: OutboxEvent): Promise<void>;
}

export interface PublishOutboxEventsResult {
  readonly published: number;
  readonly failed: number;
}

export interface PublishOutboxEventsDeps {
  readonly outbox: OutboxEventRelayRepository;
  readonly publisher: OutboxPublisher;
  readonly clock: Clock;
  readonly batchSize?: number;
}

/**
 * Dispatches the events the transaction left in PENDING.
 *
 * Until now the pattern was only half-built: events were written in the same
 * transaction as the case —which is the hard part and the one that guarantees
 * they are not lost— but nobody took them out, so they piled up in PENDING
 * indefinitely.
 *
 * Delivery is **at least once**, not exactly once: if the process dies
 * between publish and mark, the event will be retried. That is the correct
 * guarantee for an outbox — the alternative (mark before publish) would
 * silently lose events, which is much worse than delivering a duplicate.
 * Consumers must be idempotent, and `aggregateId` + `eventType` gives them
 * what they need.
 *
 * An individual failure marks that event as FAILED with its reason and the
 * sweep continues: a consumer that rejects a particular payload cannot
 * block the entire queue behind it.
 */
export function createPublishOutboxEventsUseCase(deps: PublishOutboxEventsDeps) {
  return async function publishOutboxEvents(): Promise<PublishOutboxEventsResult> {
    const pending = await deps.outbox.findPending(deps.batchSize ?? 100);

    let published = 0;
    let failed = 0;

    for (const event of pending) {
      try {
        await deps.publisher.publish(event);
        await deps.outbox.update(event.markPublished(deps.clock.now()));
        published += 1;
      } catch (error) {
        const reason = (error as Error).message;
        console.warn(`[outbox] fallo al publicar ${event.eventType} (${event.id}): ${reason}`);
        try {
          await deps.outbox.update(event.markFailed(reason));
        } catch {
          // If the failure cannot even be recorded, it is left in PENDING: the
          // next pass will retry it, which is preferable to losing it.
        }
        failed += 1;
      }
    }

    return { published, failed };
  };
}

/**
 * Default publisher: leaves a record in the log.
 *
 * This is not an empty placeholder — while there is no real consumer, it
 * leaves an auditable trail that the event went out and when, instead of
 * events getting stuck in PENDING without anyone noticing.
 */
export function createLogOutboxPublisher(): OutboxPublisher {
  return {
    async publish(event: OutboxEvent): Promise<void> {
      console.info(
        `[outbox] ${event.eventType} ${event.aggregateType}:${event.aggregateId} ${JSON.stringify(event.payload)}`,
      );
    },
  };
}

export type PublishOutboxEventsService = ReturnType<typeof createPublishOutboxEventsUseCase>;
