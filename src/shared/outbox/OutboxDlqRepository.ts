import type { DeadLetterEvent } from './DeadLetterEvent.js';
import type { OutboxEventId } from './OutboxEventId.js';
import type { CursorPage } from '../http/pagination.js';

/**
 * Query parameters for the paginated DLQ list (newest-first keyset cursor
 * over the composite `(exhausted_at DESC, _id DESC)` index).
 *
 * `cursor` is an opaque `encodeDescCursor(exhaustedAtMs, id)` value produced
 * by a previous page's `nextCursor`. Absence means "start from the beginning"
 * (the most-recently exhausted event). A malformed cursor MUST be rejected as
 * `INVARIANT_VIOLATION` by the use case, not silently reset to page 1.
 *
 * `organizationId` is optional cross-tenant filter — PLATFORM_ADMIN provides
 * it explicitly; leaving it absent returns events for all tenants.
 */
export interface DlqListQuery {
  readonly limit: number;
  readonly cursor?: string;
  readonly organizationId?: string;
}

/**
 * Port for the `dead_letter_queue` collection.
 *
 * `tx` is an opaque transaction handle threaded in by `unitOfWork.withTransaction`
 * so the DLQ insert and the `outbox_events` delete commit atomically (D1).
 *
 * `save` MUST be idempotent: a duplicate `_id` (the original event's
 * ObjectId, D2) is treated as "already moved" and silently swallowed rather
 * than propagated as an error.
 *
 * `findMany` returns a `CursorPage<DeadLetterEvent>` ordered newest-first
 * (D3). `findById` returns null when no row matches. `delete` is a no-op
 * when the row is already absent (idempotent delete inside requeue tx, D2).
 */
export interface OutboxDlqRepository {
  save(event: DeadLetterEvent, tx?: unknown): Promise<void>;
  findMany(query: DlqListQuery): Promise<CursorPage<DeadLetterEvent>>;
  findById(id: OutboxEventId): Promise<DeadLetterEvent | null>;
  delete(id: OutboxEventId, tx?: unknown): Promise<void>;
}
