import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { CaseTimelineEvent } from '../../../../domain/model/aggregates/CaseTimelineEvent.js';
import type { TimelineRecorder } from '../../../../domain/ports/TimelineRecorder.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { CaseTimelineDocument } from './documents/CaseTimelineDocument.js';
import { toDocument, toDomain } from './mappers/CaseTimelineDocumentMapper.js';

/** Casts the opaque `Transaction` handle back to a real Mongo `ClientSession` (mirrors `MongoAuditLogRepository`). */
function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'CaseTimeline';

/**
 * Mongo adapter for `TimelineRecorder`.
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

  async listByCaseId(caseId: string): Promise<readonly CaseTimelineEvent[]> {
    if (!ObjectId.isValid(caseId)) return [];
    const documents = await this.collection.find({ CaseId: new ObjectId(caseId) }).sort({ CreatedAt: -1 }).toArray();
    return documents.map(toDomain);
  }
}
