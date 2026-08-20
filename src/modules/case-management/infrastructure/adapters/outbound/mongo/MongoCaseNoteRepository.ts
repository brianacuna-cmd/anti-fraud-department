import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { CaseNote } from '../../../../domain/model/aggregates/CaseNote.js';
import type { CaseNoteRepository } from '../../../../domain/ports/CaseNoteRepository.js';
import type { CaseId } from '../../../../domain/model/value-objects/CaseId.js';
import type { CaseNoteId } from '../../../../domain/model/value-objects/CaseNoteId.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { CaseNoteDocument } from './documents/CaseNoteDocument.js';
import { toDocument, toDomain } from './mappers/CaseNoteDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'case_notes';

/**
 * Mongo adapter for `CaseNoteRepository`. `save` upserts (append + soft-delete)
 * by `_id`. `findById` returns rows regardless of `deleted_at` so the
 * soft-delete path is idempotent. `listByCaseId` returns oldest-first via the
 * `case_notes_case_created_idx` index, hiding soft-deleted notes.
 */
export class MongoCaseNoteRepository implements CaseNoteRepository {
  private readonly collection: Collection<CaseNoteDocument>;

  constructor(db: Db) {
    this.collection = db.collection<CaseNoteDocument>(COLLECTION_NAME);
  }

  async save(note: CaseNote, tx?: Transaction): Promise<void> {
    const document = toDocument(note);
    await this.collection.replaceOne({ _id: document._id }, document, {
      upsert: true,
      session: toSession(tx),
    });
  }

  async findById(id: CaseNoteId, tx?: Transaction): Promise<CaseNote | null> {
    const document = await this.collection.findOne({ _id: new ObjectId(id) }, { session: toSession(tx) });
    return document ? toDomain(document) : null;
  }

  async listByCaseId(caseId: CaseId, tx?: Transaction): Promise<CaseNote[]> {
    const documents = await this.collection
      .find({ case_id: new ObjectId(caseId), deleted_at: null }, { session: toSession(tx) })
      .sort({ created_at: 1 })
      .toArray();
    return documents.map(toDomain);
  }
}
