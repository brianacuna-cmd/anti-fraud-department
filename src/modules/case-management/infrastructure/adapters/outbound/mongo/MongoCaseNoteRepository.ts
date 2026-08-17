import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { CaseNote } from '../../../../domain/model/aggregates/CaseNote.js';
import type { CaseNoteRepository } from '../../../../domain/ports/CaseNoteRepository.js';
import type { CaseId } from '../../../../domain/model/value-objects/CaseId.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { CaseNoteDocument } from './documents/CaseNoteDocument.js';
import { toDocument, toDomain } from './mappers/CaseNoteDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'case_notes';

/**
 * Mongo adapter for `CaseNoteRepository`. Append-only — `insertOne`, never
 * update/delete. `listByCaseId` returns oldest-first via the
 * `case_notes_case_created_idx` index.
 */
export class MongoCaseNoteRepository implements CaseNoteRepository {
  private readonly collection: Collection<CaseNoteDocument>;

  constructor(db: Db) {
    this.collection = db.collection<CaseNoteDocument>(COLLECTION_NAME);
  }

  async save(note: CaseNote, tx?: Transaction): Promise<void> {
    await this.collection.insertOne(toDocument(note), { session: toSession(tx) });
  }

  async listByCaseId(caseId: CaseId, tx?: Transaction): Promise<CaseNote[]> {
    const documents = await this.collection
      .find({ case_id: new ObjectId(caseId) }, { session: toSession(tx) })
      .sort({ created_at: 1 })
      .toArray();
    return documents.map(toDomain);
  }
}
