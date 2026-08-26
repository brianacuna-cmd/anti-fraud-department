import type { DeadLetterEvent } from './DeadLetterEvent.js';

/**
 * Port for the `dead_letter_queue` collection.
 *
 * `tx` is an opaque transaction handle threaded in by `unitOfWork.withTransaction`
 * so the DLQ insert and the `outbox_events` delete commit atomically (D1).
 *
 * Implementations MUST be idempotent: a duplicate `_id` (the original event's
 * ObjectId, D2) is treated as "already moved" and silently swallowed rather
 * than propagated as an error.
 */
export interface OutboxDlqRepository {
  save(event: DeadLetterEvent, tx?: unknown): Promise<void>;
}
