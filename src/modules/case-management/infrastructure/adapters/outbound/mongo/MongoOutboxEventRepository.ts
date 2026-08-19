import { type ClientSession, type Collection, type Db } from 'mongodb';
import type { OutboxEvent } from '../../../../domain/model/aggregates/OutboxEvent.js';
import type { OutboxEventRepository } from '../../../../domain/ports/OutboxEventRepository.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { OutboxEventDocument } from './documents/OutboxEventDocument.js';
import { toDocument } from './mappers/OutboxEventDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'outbox_events';

/** Mongo adapter for `OutboxEventRepository`. Append-only insert of PENDING rows. */
export class MongoOutboxEventRepository implements OutboxEventRepository {
  private readonly collection: Collection<OutboxEventDocument>;

  constructor(db: Db) {
    this.collection = db.collection<OutboxEventDocument>(COLLECTION_NAME);
  }

  async save(event: OutboxEvent, tx?: Transaction): Promise<void> {
    await this.collection.insertOne(toDocument(event), { session: toSession(tx) });
  }
}
