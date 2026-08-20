import type { ClientSession, Collection, Db } from 'mongodb';
import type { AuditLog } from '../../../../domain/model/aggregates/AuditLog.js';
import type { AuditLogRepository } from '../../../../domain/ports/AuditLogRepository.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { AuditLogDocument } from './documents/AuditLogDocument.js';
import { toDocument } from './mappers/AuditLogDocumentMapper.js';

/** Casts the opaque `Transaction` handle back to a real Mongo `ClientSession` (design D-A4). */
function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'audit_logs';

/**
 * Mongo adapter for `AuditLogRepository` (design D-A8). Append-only —
 * `insertOne`, never `replaceOne`/`upsert`; each `AuditLog` id is unique
 * per write, there is nothing to overwrite.
 */
export class MongoAuditLogRepository implements AuditLogRepository {
  private readonly collection: Collection<AuditLogDocument>;

  constructor(db: Db) {
    this.collection = db.collection<AuditLogDocument>(COLLECTION_NAME);
  }

  async save(auditLog: AuditLog, tx?: Transaction): Promise<void> {
    const document = toDocument(auditLog);
    await this.collection.insertOne(document, { session: toSession(tx) });
  }
}
