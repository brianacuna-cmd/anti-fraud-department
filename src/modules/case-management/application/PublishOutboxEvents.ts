import type { Clock } from '../../../shared/time/Clock.js';
import type { OutboxEventRelayRepository } from '../../../shared/outbox/OutboxEventRelayRepository.js';
import type { OutboxDlqRepository } from '../../../shared/outbox/OutboxDlqRepository.js';
import type { OutboxRetryPolicy } from '../../../shared/outbox/OutboxRetryPolicy.js';
import { computeRetryAt } from '../../../shared/outbox/OutboxRetryPolicy.js';
import { DeadLetterEvent } from '../../../shared/outbox/DeadLetterEvent.js';
import type { OutboxEvent } from '../../../shared/outbox/OutboxEvent.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';

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
  readonly retried: number;
  readonly deadLettered: number;
}

export interface PublishOutboxEventsDeps {
  readonly outbox: OutboxEventRelayRepository;
  readonly publisher: OutboxPublisher;
  readonly clock: Clock;
  readonly dlq: OutboxDlqRepository;
  readonly unitOfWork: UnitOfWork;
  readonly retryPolicy: OutboxRetryPolicy;
  /** Defaults to `Math.random`. Injected for deterministic tests (D6). */
  readonly rng?: () => number;
  readonly batchSize?: number;
}

/**
 * Dispatches the events the transaction left in PENDING.
 *
 * Failure handling:
 * - `attemptsAfter < maxAttempts` → keep PENDING with jittered `nextRetryAt`
 *   (scheduleRetry). The event is invisible to the next sweep until the delay
 *   elapses, so a bad payload does not hammer the broker.
 * - `attemptsAfter >= maxAttempts` → atomically delete from `outbox_events`
 *   and insert into `dead_letter_queue` inside a single transaction (D1).
 *   If the transaction aborts the row remains PENDING for the next sweep;
 *   a duplicate DLQ insert is swallowed as already-moved (D2).
 *
 * Delivery is **at least once**, not exactly once: if the process dies
 * between publish and mark, the event will be retried. Consumers must be
 * idempotent. Retries stay PENDING (never FAILED) so `findPending`'s
 * `status = 'PENDING'` filter alone gates them.
 */
export function createPublishOutboxEventsUseCase(deps: PublishOutboxEventsDeps) {
  const rng = deps.rng ?? Math.random;

  return async function publishOutboxEvents(): Promise<PublishOutboxEventsResult> {
    const now = deps.clock.now();
    const pending = await deps.outbox.findPending(now, deps.batchSize ?? 100);

    let published = 0;
    let failed = 0;
    let retried = 0;
    let deadLettered = 0;

    for (const event of pending) {
      try {
        await deps.publisher.publish(event);
        await deps.outbox.update(event.markPublished(now));
        published += 1;
      } catch (error) {
        const reason = (error as Error).message;
        console.warn(`[outbox] fallo al publicar ${event.eventType} (${event.id}): ${reason}`);
        failed += 1;

        const attemptsAfter = event.publishAttempts + 1;

        if (attemptsAfter < deps.retryPolicy.maxAttempts) {
          const nextRetryAt = computeRetryAt(deps.retryPolicy, attemptsAfter, now, rng);
          try {
            await deps.outbox.update(event.scheduleRetry(nextRetryAt));
          } catch {
            // If the reschedule cannot be persisted, leave the row PENDING so
            // the next sweep retries it — preferable to losing the event.
          }
          retried += 1;
        } else {
          const exhausted = event.markExhausted(reason);
          try {
            await deps.unitOfWork.withTransaction(async (tx) => {
              await deps.dlq.save(DeadLetterEvent.from(exhausted, now), tx);
              await deps.outbox.delete(event.id, tx);
            });
            deadLettered += 1;
          } catch (moveError) {
            // Transaction aborted: row stays in outbox for the next sweep.
            // A committed DLQ insert is a no-op on retry (D2: _id is unique).
            console.warn(
              `[outbox] movimiento a DLQ abortado para ${event.eventType} (${event.id}): ${(moveError as Error).message}`,
            );
          }
        }
      }
    }

    return { published, failed, retried, deadLettered };
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
