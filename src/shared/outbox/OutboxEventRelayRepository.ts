import type { OutboxEvent } from './OutboxEvent.js';

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
  /** Events still undelivered, oldest to newest. */
  findPending(limit?: number, tx?: unknown): Promise<readonly OutboxEvent[]>;
  /**
   * Persists the outcome of an attempt on a row that already exists. Distinct
   * from `save` because that one inserts — the outbox is append-only on the
   * write path — and here we always update.
   */
  update(event: OutboxEvent, tx?: unknown): Promise<void>;
}
