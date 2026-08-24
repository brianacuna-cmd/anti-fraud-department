import type { ClientSession, Collection, Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { AmlExpedienteTimelineEvent, AmlExpedienteTimelineRecorder } from '../../../../domain/ports/AmlExpedienteTimelineRecorder.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { AmlExpedienteTimelineDocument } from './documents/AmlExpedienteTimelineDocument.js';
import { toDocument, toDomain } from './mappers/AmlExpedienteTimelineDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'case_timeline';

/**
 * Screening adapter that appends AML expediente opens onto the shared
 * `case_timeline` collection (`insertOne`, never replace/update/delete).
 */
export class MongoAmlExpedienteTimelineRecorder implements AmlExpedienteTimelineRecorder {
  private readonly collection: Collection<AmlExpedienteTimelineDocument>;

  constructor(db: Db) {
    this.collection = db.collection<AmlExpedienteTimelineDocument>(COLLECTION_NAME);
  }

  async record(event: AmlExpedienteTimelineEvent, tx?: Transaction): Promise<void> {
    await this.collection.insertOne(toDocument(event), { session: toSession(tx) });
  }

  async listByAlertId(alertId: string, tx?: Transaction): Promise<AmlExpedienteTimelineEvent[]> {
    const documents = await this.collection
      .find({ case_id: new ObjectId(alertId) }, { session: toSession(tx) })
      .sort({ created_at: 1 })
      .toArray();
    return documents.map(toDomain);
  }
}
