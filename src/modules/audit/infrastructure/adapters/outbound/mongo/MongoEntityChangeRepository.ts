import type { ClientSession, Collection, Db } from 'mongodb';
import type { EntityChange } from '../../../../domain/model/aggregates/EntityChange.js';
import type { EntityChangeRepository } from '../../../../domain/ports/EntityChangeRepository.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { EntityChangeDocument } from './documents/EntityChangeDocument.js';
import { toDocument } from './mappers/EntityChangeDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'entity_change_log';

/** Append-only, igual que `MongoAuditLogRepository`: `insertOne`, nunca upsert. */
export class MongoEntityChangeRepository implements EntityChangeRepository {
  private readonly collection: Collection<EntityChangeDocument>;

  constructor(db: Db) {
    this.collection = db.collection<EntityChangeDocument>(COLLECTION_NAME);
  }

  async save(change: EntityChange, tx?: Transaction): Promise<void> {
    await this.collection.insertOne(toDocument(change), { session: toSession(tx) });
  }
}
