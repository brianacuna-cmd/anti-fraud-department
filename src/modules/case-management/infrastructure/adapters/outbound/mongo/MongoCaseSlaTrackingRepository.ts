import type { ClientSession, Collection, Db } from 'mongodb';
import type { Instant } from '../../../../../../shared/time/Instant.js';
import type { CaseSlaTracking } from '../../../../domain/model/aggregates/CaseSlaTracking.js';
import type { CaseSlaTrackingRepository } from '../../../../domain/ports/CaseSlaTrackingRepository.js';
import type { CaseId } from '../../../../domain/model/value-objects/CaseId.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { CaseSlaTrackingDocument } from './documents/CaseSlaTrackingDocument.js';
import { toDocument, toDomain } from './mappers/CaseSlaTrackingDocumentMapper.js';

/** Casts the opaque `Transaction` handle back to a real Mongo `ClientSession` (mirrors `MongoCaseRepository`). */
function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'CaseSlaTracking';

/**
 * Mongo adapter for `CaseSlaTrackingRepository` (design: "CaseSlaTracking:
 * one per CaseId — Status ON_TRACK -> WARNING -> BREACHED"). `save` is a
 * `replaceOne` upsert by `_id`, mirroring `MongoCaseRepository`; the
 * one-row-per-CaseId invariant is enforced by the `sla_tracking_case_unique`
 * index, never re-checked here. `findDueForSweep` queries the `DueDateAt`
 * BSON mirror — never the `DueDate` ISO string — per design ADR-6.
 */
export class MongoCaseSlaTrackingRepository implements CaseSlaTrackingRepository {
  private readonly collection: Collection<CaseSlaTrackingDocument>;

  constructor(db: Db) {
    this.collection = db.collection<CaseSlaTrackingDocument>(COLLECTION_NAME);
  }

  async save(tracking: CaseSlaTracking, tx?: Transaction): Promise<void> {
    const document = toDocument(tracking);
    await this.collection.replaceOne({ _id: document._id }, document, {
      upsert: true,
      session: toSession(tx),
    });
  }

  async findByCaseId(caseId: CaseId, tx?: Transaction): Promise<CaseSlaTracking | null> {
    const document = await this.collection.findOne({ CaseId: caseId }, { session: toSession(tx) });
    return document ? toDomain(document) : null;
  }

  async findDueForSweep(now: Instant, tx?: Transaction): Promise<CaseSlaTracking[]> {
    const documents = await this.collection
      .find(
        { DueDateAt: { $lte: new Date(now) }, Status: { $ne: 'BREACHED' } },
        { session: toSession(tx) },
      )
      .toArray();
    return documents.map(toDomain);
  }
}
