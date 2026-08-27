import type { Instant } from '../time/Instant.js';
import type { OutboxEvent } from './OutboxEvent.js';
import type { OutboxEventId } from './OutboxEventId.js';

/**
 * Reader side of the transactional outbox, used by the relay.
 *
 * Kept apart from `OutboxEventRepository` on purpose: that port is
 * implemented by dozens of test doubles that only need to write inside a
 * transaction, and adding a `findPending` they never call would only break
 * them. The relay runs OUTSIDE the business transaction, so it does not
 * share those needs either.
 */
export interface OutboxEventRelayRepository {
  /**
   * Events still undelivered, oldest to newest.
   *
   * `now` is a required first parameter so every stale call site and test
   * double becomes a compile error rather than a silently-unfiltered query.
   * Only events where `next_retry_at IS NULL OR next_retry_at <= now` are
   * returned (due-time gate, D3/D5 spec).
   */
  findPending(now: Instant, limit?: number, tx?: unknown): Promise<readonly OutboxEvent[]>;

  /**
   * Persists the outcome of an attempt on a row that already exists. Distinct
   * from `save` because that one inserts — the outbox is append-only on the
   * write path — and here we always update.
   */
  update(event: OutboxEvent, tx?: unknown): Promise<void>;

  /**
   * Removes a row that has been moved to the DLQ. Called inside the same
   * transaction as `OutboxDlqRepository.save` (D1).
   */
  delete(id: OutboxEventId, tx?: unknown): Promise<void>;
}
