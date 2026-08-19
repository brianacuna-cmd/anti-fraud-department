import { type ClientSession, type Collection, type Db } from 'mongodb';
import type { OutboxEvent } from '../OutboxEvent.js';
import type { OutboxEventRepository } from '../OutboxEventRepository.js';
import type { OutboxEventDocument } from './OutboxEventDocument.js';
import { toDocument } from './OutboxEventDocumentMapper.js';

function toSession(tx: unknown): ClientSession | undefined {
  return tx as ClientSession | undefined;
}

const COLLECTION_NAME = 'outbox_events';

/** Shared Mongo adapter for `OutboxEventRepository`. Append-only insert of PENDING rows. */
export class MongoOutboxEventRepository implements OutboxEventRepository {
  private readonly collection: Collection<OutboxEventDocument>;

  constructor(db: Db) {
    this.collection = db.collection<OutboxEventDocument>(COLLECTION_NAME);
  }

  async save(event: OutboxEvent, tx?: unknown): Promise<void> {
    await this.collection.insertOne(toDocument(event), { session: toSession(tx) });
  }
}
