import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { DeadLetterEvent } from '../DeadLetterEvent.js';
import type { DlqListQuery, OutboxDlqRepository } from '../OutboxDlqRepository.js';
import type { OutboxEventId } from '../OutboxEventId.js';
import type { CursorPage } from '../../http/pagination.js';
import { buildDescCursorPage, decodeDescCursor, encodeDescCursor } from '../../http/pagination.js';
import { toDate } from '../../time/Instant.js';
import { isDuplicateKeyError } from '../../persistence/mongo/duplicateKey.js';
import type { DeadLetterEventDocument } from './DeadLetterEventDocument.js';
import { toDocument, toDomain } from './DeadLetterEventDocumentMapper.js';

function toSession(tx: unknown): ClientSession | undefined {
  return tx as ClientSession | undefined;
}

const COLLECTION_NAME = 'dead_letter_queue';

/**
 * Mongo adapter for `OutboxDlqRepository`. `_id` is the original event's
 * ObjectId (D2), so a duplicate-key error (E11000) means the event was
 * already moved — the adapter swallows it and returns normally so the owning
 * use case can proceed to the outbox delete without rethrowing.
 *
 * IMPORTANT: the adapter is NOT self-transacting. The owning use case
 * (`PublishOutboxEvents`) passes its `UnitOfWork.withTransaction` session as
 * `tx` so the DLQ insert and outbox delete commit atomically (D1).
 */
export class MongoOutboxDlqRepository implements OutboxDlqRepository {
  private readonly collection: Collection<DeadLetterEventDocument>;

  constructor(db: Db) {
    this.collection = db.collection<DeadLetterEventDocument>(COLLECTION_NAME);
  }

  async save(event: DeadLetterEvent, tx?: unknown): Promise<void> {
    try {
      await this.collection.insertOne(toDocument(event), { session: toSession(tx) });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        return; // already moved — swallow E11000 (D2)
      }
      throw err;
    }
  }

  /**
   * Newest-first keyset pagination over `(exhausted_at DESC, _id DESC)`.
   *
   * When a cursor is present it must already be validated by the use case
   * (`decodeDescCursor` returning non-null). A null decode here is treated as
   * "no cursor" (full page from the beginning) to keep the adapter from
   * throwing; the use case is the authoritative INVARIANT_VIOLATION gate.
   *
   * MongoDB filter: `{$or: [{exhausted_at: {$lt: d}}, {exhausted_at: d, _id: {$lt: oid}}]}`
   * combined with optional `organization_id` equality at the top level (AND).
   */
  async findMany(query: DlqListQuery): Promise<CursorPage<DeadLetterEvent>> {
    const filter: Record<string, unknown> = {};

    if (query.organizationId !== undefined) {
      filter.organization_id = new ObjectId(query.organizationId);
    }

    if (query.cursor !== undefined) {
      const decoded = decodeDescCursor(query.cursor);
      if (decoded !== null) {
        const d = new Date(decoded.exhaustedAtMs);
        const oid = new ObjectId(decoded.id);
        filter.$or = [
          { exhausted_at: { $lt: d } },
          { exhausted_at: d, _id: { $lt: oid } },
        ];
      }
    }

    const docs = await this.collection
      .find(filter as Parameters<typeof this.collection.find>[0])
      .sort({ exhausted_at: -1, _id: -1 })
      .limit(query.limit + 1)
      .toArray();

    const events = docs.map(toDomain);
    return buildDescCursorPage(
      events,
      query.limit,
      (e) => encodeDescCursor(toDate(e.exhaustedAt).getTime(), e.id),
    );
  }

  /** Returns `null` when no row matches the given id. */
  async findById(id: OutboxEventId): Promise<DeadLetterEvent | null> {
    const doc = await this.collection.findOne({ _id: new ObjectId(id as string) });
    return doc ? toDomain(doc) : null;
  }

  /**
   * Idempotent delete: `deleteOne` is a no-op when the row is absent.
   * `tx` is optional — must be provided when running inside
   * `unitOfWork.withTransaction` so the delete is part of the requeue
   * atomic operation (D2).
   */
  async delete(id: OutboxEventId, tx?: unknown): Promise<void> {
    await this.collection.deleteOne(
      { _id: new ObjectId(id as string) },
      { session: toSession(tx) },
    );
  }
}
