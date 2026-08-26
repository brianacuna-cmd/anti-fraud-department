import { type ClientSession, type Collection, type Db } from 'mongodb';
import type { DeadLetterEvent } from '../DeadLetterEvent.js';
import type { DlqListQuery, OutboxDlqRepository } from '../OutboxDlqRepository.js';
import type { OutboxEventId } from '../OutboxEventId.js';
import type { CursorPage } from '../../http/pagination.js';
import { isDuplicateKeyError } from '../../persistence/mongo/duplicateKey.js';
import type { DeadLetterEventDocument } from './DeadLetterEventDocument.js';
import { toDocument } from './DeadLetterEventDocumentMapper.js';

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

  // PR2: read + delete methods — stubs satisfy the TypeScript port contract;
  // real implementations land in the Mongo adapter PR.
  async findMany(query: DlqListQuery): Promise<CursorPage<DeadLetterEvent>> {
    void query;
    throw new Error('MongoOutboxDlqRepository.findMany: not implemented — PR2');
  }

  async findById(id: OutboxEventId): Promise<DeadLetterEvent | null> {
    void id;
    throw new Error('MongoOutboxDlqRepository.findById: not implemented — PR2');
  }

  async delete(id: OutboxEventId, tx?: unknown): Promise<void> {
    void id;
    void tx;
    throw new Error('MongoOutboxDlqRepository.delete: not implemented — PR2');
  }
}
