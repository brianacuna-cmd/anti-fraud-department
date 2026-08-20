import { type ClientSession, type Collection, type Db } from 'mongodb';
import type { OutboxEvent } from '../OutboxEvent.js';
import type { OutboxEventRepository } from '../OutboxEventRepository.js';
import type { OutboxEventRelayRepository } from '../OutboxEventRelayRepository.js';
import type { OutboxEventDocument } from './OutboxEventDocument.js';
import { toDocument, toDomain } from './OutboxEventDocumentMapper.js';

function toSession(tx: unknown): ClientSession | undefined {
  return tx as ClientSession | undefined;
}

const COLLECTION_NAME = 'outbox_events';

/**
 * Shared Mongo adapter for `OutboxEventRepository`. Append-only insert of PENDING rows.
 *
 * Implementa ademas `OutboxEventRelayRepository`, el lado que consume el relay:
 * misma coleccion, mismo mapper, sin un segundo adaptador que mantener en
 * paralelo.
 */
export class MongoOutboxEventRepository implements OutboxEventRepository, OutboxEventRelayRepository {
  private readonly collection: Collection<OutboxEventDocument>;

  constructor(db: Db) {
    this.collection = db.collection<OutboxEventDocument>(COLLECTION_NAME);
  }

  async save(event: OutboxEvent, tx?: unknown): Promise<void> {
    await this.collection.insertOne(toDocument(event), { session: toSession(tx) });
  }

  async findPending(limit = 100, tx?: unknown): Promise<readonly OutboxEvent[]> {
    const documents = await this.collection
      .find({ status: 'PENDING' }, { session: toSession(tx) })
      .sort({ _id: 1 })
      .limit(limit)
      .toArray();
    return documents.map(toDomain);
  }

  async update(event: OutboxEvent, tx?: unknown): Promise<void> {
    const document = toDocument(event);
    await this.collection.replaceOne({ _id: document._id }, document, { session: toSession(tx) });
  }
}
