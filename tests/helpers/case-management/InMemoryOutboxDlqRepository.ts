import type { DeadLetterEvent } from '../../../src/shared/outbox/DeadLetterEvent.js';
import type { OutboxDlqRepository } from '../../../src/shared/outbox/OutboxDlqRepository.js';

/**
 * In-memory test double for `OutboxDlqRepository`.
 *
 * Duplicate-id saves are silently ignored (no-op), mirroring the Mongo
 * adapter's E11000 swallow behaviour (D2).
 */
export class InMemoryOutboxDlqRepository implements OutboxDlqRepository {
  private readonly entries: Map<string, DeadLetterEvent> = new Map();

  async save(event: DeadLetterEvent, _tx?: unknown): Promise<void> {
    if (this.entries.has(event.id)) return; // idempotent: duplicate-id no-op
    this.entries.set(event.id, event);
  }

  /** Test-only accessor. */
  all(): readonly DeadLetterEvent[] {
    return [...this.entries.values()];
  }
}
