import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import { toDate, type Instant } from '../../../../../../shared/time/Instant.js';
import type { CustomerOutgoingEvent } from '../../../../domain/model/aggregates/CustomerOutgoingEvent.js';
import type { CustomerOutgoingEventRepository } from '../../../../domain/ports/CustomerOutgoingEventRepository.js';
import type { CustomerOutgoingEventId } from '../../../../domain/model/value-objects/CustomerOutgoingEventId.js';
import type { EnforcementActionId } from '../../../../domain/model/value-objects/EnforcementActionId.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { CustomerOutgoingEventDocument } from './documents/CustomerOutgoingEventDocument.js';
import { toDocument, toDomain } from './mappers/CustomerOutgoingEventDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'customer_outgoing_events';

/** Fixed backoff schedule (seconds): 1, 2, 4, 8, 16 for attempts 0..4. */
const BACKOFF_SECONDS = [1, 2, 4, 8, 16] as const;

export class MongoCustomerOutgoingEventRepository implements CustomerOutgoingEventRepository {
  private readonly collection: Collection<CustomerOutgoingEventDocument>;

  constructor(db: Db) {
    this.collection = db.collection<CustomerOutgoingEventDocument>(COLLECTION_NAME);
  }

  async save(event: CustomerOutgoingEvent, tx?: Transaction): Promise<void> {
    const document = toDocument(event);
    await this.collection.replaceOne({ _id: document._id }, document, {
      upsert: true,
      session: toSession(tx),
    });
  }

  async findById(id: CustomerOutgoingEventId, tx?: Transaction): Promise<CustomerOutgoingEvent | null> {
    const document = await this.collection.findOne({ _id: new ObjectId(id) }, { session: toSession(tx) });
    return document ? toDomain(document) : null;
  }

  async findByEnforcementActionId(
    enforcementActionId: EnforcementActionId,
    tx?: Transaction,
  ): Promise<CustomerOutgoingEvent | null> {
    const document = await this.collection.findOne(
      { enforcement_action_id: new ObjectId(enforcementActionId) },
      { session: toSession(tx) },
    );
    return document ? toDomain(document) : null;
  }

  async claimPending(now: Instant, limit: number, tx?: Transaction): Promise<CustomerOutgoingEvent[]> {
    const documents = await this.collection
      .find({ status: 'PENDING', attempts: { $lt: 5 } }, { session: toSession(tx) })
      .sort({ created_at: 1 })
      .toArray();

    const nowMs = toDate(now).getTime();
    const due = documents.filter((document) => {
      if (document.last_attempt_at === null) {
        return true;
      }
      const delaySeconds =
        BACKOFF_SECONDS[Math.min(document.attempts, BACKOFF_SECONDS.length - 1)] ?? 16;
      return nowMs >= document.last_attempt_at.getTime() + delaySeconds * 1000;
    });

    return due.slice(0, limit).map(toDomain);
  }
}
