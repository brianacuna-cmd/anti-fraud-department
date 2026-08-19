import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import { OutboxEvent } from '../../../../domain/model/aggregates/OutboxEvent.js';
import { brand } from '../../../../../../shared/kernel/Brand.js';
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

  private toDocument(event: OutboxEvent): OutboxEventDocument {
    return {
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
  }

  private toDomain(document: OutboxEventDocument): OutboxEvent {
    return OutboxEvent.rehydrate({
      id: document._id.toString(),
      aggregateType: document.AggregateType,
      aggregateId: document.AggregateId,
      eventType: document.EventType,
      payload: document.Payload,
      status: document.Status as 'PENDING' | 'PUBLISHED' | 'FAILED',
      createdAt: brand<string, 'Instant'>(document.CreatedAt),
      publishedAt: document.PublishedAt === null ? null : brand<string, 'Instant'>(document.PublishedAt),
      error: document.Error,
    });
  }

  async record(event: OutboxEvent, tx?: Transaction): Promise<void> {
    await this.collection.insertOne(this.toDocument(event), { session: toSession(tx) });
  }

  /**
   * Del mas antiguo al mas reciente: los consumidores de un outbox suelen
   * asumir el orden en que ocurrieron los hechos, y despachar el ultimo
   * primero entregaria un `case.reopened` antes que su `case.created`.
   */
  async findPending(limit = 100, tx?: Transaction): Promise<readonly OutboxEvent[]> {
    const documents = await this.collection
      .find({ Status: 'PENDING' }, { session: toSession(tx) })
      .sort({ _id: 1 })
      .limit(limit)
      .toArray();
    return documents.map((doc) => this.toDomain(doc));
  }

  async save(event: OutboxEvent, tx?: Transaction): Promise<void> {
    const document = this.toDocument(event);
    await this.collection.replaceOne({ _id: document._id }, document, {
      upsert: true,
      session: toSession(tx),
    });
  }
}
