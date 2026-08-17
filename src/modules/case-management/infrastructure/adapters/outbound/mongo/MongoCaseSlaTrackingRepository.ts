import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import { toDate, type Instant } from '../../../../../../shared/time/Instant.js';
import type { CaseSlaTracking } from '../../../../domain/model/aggregates/CaseSlaTracking.js';
import type { CaseSlaTrackingRepository } from '../../../../domain/ports/CaseSlaTrackingRepository.js';
import type { CaseId } from '../../../../domain/model/value-objects/CaseId.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { CaseSlaTrackingDocument } from './documents/CaseSlaTrackingDocument.js';
import { toDocument, toDomain } from './mappers/CaseSlaTrackingDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'case_sla_tracking';

/** Sweep lease TTL: a claim older than this is considered abandoned (crashed claimer) and reclaimable. */
const LEASE_TTL_MS = 5 * 60 * 1000;

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
    const document = await this.collection.findOne({ case_id: new ObjectId(caseId) }, { session: toSession(tx) });
    return document ? toDomain(document) : null;
  }

  async claimDueForSweep(now: Instant, limit: number, tx?: Transaction): Promise<CaseSlaTracking[]> {
    const nowMs = toDate(now).getTime();
    const nowDate = new Date(nowMs);
    const leaseExpiry = new Date(nowMs - LEASE_TTL_MS);

    const claimed: CaseSlaTrackingDocument[] = [];
    // Exclusive lease claim: each findOneAndUpdate atomically reserves one due
    // row, so concurrent sweep instances never process the same row twice.
    for (let i = 0; i < limit; i += 1) {
      const result = await this.collection.findOneAndUpdate(
        {
          due_date: { $lte: nowDate },
          status: { $ne: 'BREACHED' },
          $or: [{ claimed_at: null }, { claimed_at: { $exists: false } }, { claimed_at: { $lte: leaseExpiry } }],
        },
        { $set: { claimed_at: nowDate } },
        { sort: { due_date: 1 }, returnDocument: 'after', session: toSession(tx) },
      );

      if (!result) {
        break;
      }
      claimed.push(result);
    }

    return claimed.map(toDomain);
  }
}
