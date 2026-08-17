import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { CaseTimelineEvent } from '../../../../domain/model/aggregates/CaseTimelineEvent.js';
import type { TimelineReader } from '../../../../domain/ports/TimelineReader.js';
import type { CaseId } from '../../../../domain/model/value-objects/CaseId.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { CaseTimelineDocument } from './documents/CaseTimelineDocument.js';
import { toDomain } from './mappers/CaseTimelineDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'case_timeline';

/**
 * Read adapter over the `case_timeline` collection (write side is
 * `MongoTimelineRecorder`). Returns one case's events sorted oldest-first via
 * the existing `case_timeline_case_created_idx` index.
 */
export class MongoTimelineReader implements TimelineReader {
  private readonly collection: Collection<CaseTimelineDocument>;

  constructor(db: Db) {
    this.collection = db.collection<CaseTimelineDocument>(COLLECTION_NAME);
  }

  async listByCaseId(caseId: CaseId, tx?: Transaction): Promise<CaseTimelineEvent[]> {
    const documents = await this.collection
      .find({ case_id: new ObjectId(caseId) }, { session: toSession(tx) })
      .sort({ created_at: 1 })
      .toArray();
    return documents.map(toDomain);
  }
}
