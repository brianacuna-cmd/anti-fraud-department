import type { ClientSession, Collection, Db } from 'mongodb';
import type { CaseTimelineEvent } from '../../../../domain/model/aggregates/CaseTimelineEvent.js';
import type { TimelineRecorder } from '../../../../domain/ports/TimelineRecorder.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { CaseTimelineDocument } from './documents/CaseTimelineDocument.js';
import { toDocument } from './mappers/CaseTimelineDocumentMapper.js';

/** Casts the opaque `Transaction` handle back to a real Mongo `ClientSession` (mirrors `MongoAuditLogRepository`). */
function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'CaseTimeline';

/**
 * Mongo adapter for `TimelineRecorder` (design: "CaseTimeline is append-only").
 * Append-only — `insertOne`, never `replaceOne`/`updateOne`/`deleteOne`; each
 * `CaseTimelineEvent` id is unique per write, there is nothing to overwrite
 * (mirrors `MongoAuditLogRepository` exactly).
 */
export class MongoTimelineRecorder implements TimelineRecorder {
  private readonly collection: Collection<CaseTimelineDocument>;

  constructor(db: Db) {
    this.collection = db.collection<CaseTimelineDocument>(COLLECTION_NAME);
  }

  async record(event: CaseTimelineEvent, tx?: Transaction): Promise<void> {
    const document = toDocument(event);
    await this.collection.insertOne(document, { session: toSession(tx) });
  }
}
