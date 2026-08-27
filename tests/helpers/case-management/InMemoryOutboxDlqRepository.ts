import type { DeadLetterEvent } from '../../../src/shared/outbox/DeadLetterEvent.js';
import type { DlqListQuery, OutboxDlqRepository } from '../../../src/shared/outbox/OutboxDlqRepository.js';
import type { OutboxEventId } from '../../../src/shared/outbox/OutboxEventId.js';
import type { CursorPage } from '../../../src/shared/http/pagination.js';
import { encodeDescCursor, decodeDescCursor, buildDescCursorPage } from '../../../src/shared/http/pagination.js';
import { toDate } from '../../../src/shared/time/Instant.js';

/**
 * In-memory test double for `OutboxDlqRepository`.
 *
 * Duplicate-id saves are silently ignored (no-op), mirroring the Mongo
 * adapter's E11000 swallow behaviour (D2).
 *
 * `findMany` sorts DESC by `(exhaustedAt, id)` to mirror the Mongo adapter's
 * `dlq_exhausted_idx` keyset sort (D3). The cursor is an `encodeDescCursor`
 * composite so tests using the in-memory adapter exercise the same cursor
 * round-trip as production.
 */
export class InMemoryOutboxDlqRepository implements OutboxDlqRepository {
  private readonly entries: Map<string, DeadLetterEvent> = new Map();

  async save(event: DeadLetterEvent, _tx?: unknown): Promise<void> {
    if (this.entries.has(event.id)) return; // idempotent: duplicate-id no-op
    this.entries.set(event.id, event);
  }

  async findMany(query: DlqListQuery): Promise<CursorPage<DeadLetterEvent>> {
    let events = [...this.entries.values()];

    if (query.organizationId !== undefined) {
      events = events.filter((e) => e.organizationId === query.organizationId);
    }

    // Sort newest-first: DESC exhaustedAt, then DESC id as tiebreak
    events.sort((a, b) => {
      const ta = toDate(a.exhaustedAt).getTime();
      const tb = toDate(b.exhaustedAt).getTime();
      if (ta !== tb) return tb - ta;
      return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
    });

    if (query.cursor !== undefined) {
      const decoded = decodeDescCursor(query.cursor);
      if (decoded === null) {
        // Callers are expected to throw INVARIANT_VIOLATION before reaching
        // the repository; this guard protects against direct in-memory misuse.
        throw new Error('malformed desc cursor');
      }
      const { exhaustedAtMs, id } = decoded;
      events = events.filter((e) => {
        const ms = toDate(e.exhaustedAt).getTime();
        if (ms !== exhaustedAtMs) return ms < exhaustedAtMs;
        return e.id < id;
      });
    }

    return buildDescCursorPage(
      events,
      query.limit,
      (e) => encodeDescCursor(toDate(e.exhaustedAt).getTime(), e.id),
    );
  }

  async findById(id: OutboxEventId): Promise<DeadLetterEvent | null> {
    return this.entries.get(id) ?? null;
  }

  async delete(id: OutboxEventId, _tx?: unknown): Promise<void> {
    this.entries.delete(id); // idempotent: no-op if absent
  }

  /** Test-only accessor. */
  all(): readonly DeadLetterEvent[] {
    return [...this.entries.values()];
  }
}
