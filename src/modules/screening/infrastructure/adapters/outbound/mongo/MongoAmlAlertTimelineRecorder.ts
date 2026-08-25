import type { ClientSession, Collection, Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { AmlAlertTimelineEvent, AmlAlertTimelineRecorder } from '../../../../domain/ports/AmlAlertTimelineRecorder.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { AmlAlertTimelineDocument } from './documents/AmlAlertTimelineDocument.js';
import { toDocument, toDomain } from './mappers/AmlAlertTimelineDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'case_timeline';

/**
 * Screening adapter that appends AML alert opens onto the shared
 * `case_timeline` collection (`insertOne`, never replace/update/delete).
 */
export class MongoAmlAlertTimelineRecorder implements AmlAlertTimelineRecorder {
  private readonly collection: Collection<AmlAlertTimelineDocument>;

  constructor(db: Db) {
    this.collection = db.collection<AmlAlertTimelineDocument>(COLLECTION_NAME);
  }

  async record(event: AmlAlertTimelineEvent, tx?: Transaction): Promise<void> {
    await this.collection.insertOne(toDocument(event), { session: toSession(tx) });
  }

  async listByAlertId(alertId: string, tx?: Transaction): Promise<AmlAlertTimelineEvent[]> {
    const documents = await this.collection
      .find({ case_id: new ObjectId(alertId) }, { session: toSession(tx) })
      .sort({ created_at: 1 })
      .toArray();
    return documents.map(toDomain);
  }
}
