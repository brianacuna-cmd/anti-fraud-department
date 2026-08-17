import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { OutboxEvent } from '../../../../domain/model/aggregates/OutboxEvent.js';
import type { OutboxRepository } from '../../../../domain/ports/OutboxRepository.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { OutboxEventDocument } from './documents/OutboxEventDocument.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'OutboxEvents';

export class MongoOutboxRepository implements OutboxRepository {
  private readonly collection: Collection<OutboxEventDocument>;

  constructor(db: Db) {
    this.collection = db.collection<OutboxEventDocument>(COLLECTION_NAME);
  }

  async record(event: OutboxEvent, tx?: Transaction): Promise<void> {
    const document: OutboxEventDocument = {
      _id: ObjectId.isValid(event.id) ? new ObjectId(event.id) : new ObjectId(),
      AggregateType: event.aggregateType,
      AggregateId: event.aggregateId,
      EventType: event.eventType,
      Payload: event.payload,
      Status: event.status,
      CreatedAt: event.createdAt,
      PublishedAt: event.publishedAt,
      Error: event.error,
    };

    await this.collection.insertOne(document, { session: toSession(tx) });
  }
}
