import type { ClientSession, Collection, Db } from 'mongodb';
import type { Case } from '../../../../domain/model/aggregates/Case.js';
import type { CaseRepository } from '../../../../domain/ports/CaseRepository.js';
import type { CaseId } from '../../../../domain/model/value-objects/CaseId.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { CaseDocument } from './documents/CaseDocument.js';
import { toDocument, toDomain } from './mappers/CaseDocumentMapper.js';

/** Casts the opaque `Transaction` handle back to a real Mongo `ClientSession` (mirrors identity-access). */
function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'Cases';

/** Mongo adapter for `CaseRepository` (Slice 1 — Foundation: save/findById round-trip only). */
export class MongoCaseRepository implements CaseRepository {
  private readonly collection: Collection<CaseDocument>;

  constructor(db: Db) {
    this.collection = db.collection<CaseDocument>(COLLECTION_NAME);
  }

  async save(kase: Case, tx?: Transaction): Promise<void> {
    const document = toDocument(kase);
    await this.collection.replaceOne({ _id: document._id }, document, {
      upsert: true,
      session: toSession(tx),
    });
  }

  async findById(id: CaseId, tx?: Transaction): Promise<Case | null> {
    const document = await this.collection.findOne({ _id: id }, { session: toSession(tx) });
    return document ? toDomain(document) : null;
  }
}
