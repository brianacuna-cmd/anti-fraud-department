import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type {
  AdminChallengeEntry,
  AdminChallengeRecord,
  AdminChallengeStore,
} from '../../../../domain/ports/AdminChallengeStore.js';
import { fromDate, toDate, type Instant } from '../../../../../../shared/time/Instant.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { AdminChallengeDocument } from './documents/AdminChallengeDocument.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'admin_challenges';

export class MongoAdminChallengeRepository implements AdminChallengeStore {
  private readonly collection: Collection<AdminChallengeDocument>;

  constructor(db: Db) {
    this.collection = db.collection<AdminChallengeDocument>(COLLECTION_NAME);
  }

  async append(record: AdminChallengeRecord, tx?: Transaction): Promise<void> {
    const document: AdminChallengeDocument = {
      _id: record.challengeId,
      admin_organization_id: new ObjectId(record.adminOrganizationId),
      challenge: record.challenge,
      expires_at: toDate(record.expiresAt),
      consumed_at: null,
      created_at: toDate(record.now),
    };
    await this.collection.insertOne(document, { session: toSession(tx) });
  }

  async consume(challengeId: string, now: Instant, tx?: Transaction): Promise<boolean> {
    const result = await this.collection.updateOne(
      { _id: challengeId, consumed_at: null, expires_at: { $gt: toDate(now) } },
      { $set: { consumed_at: toDate(now) } },
      { session: toSession(tx) },
    );
    return result.modifiedCount === 1;
  }

  async findById(challengeId: string): Promise<AdminChallengeEntry | null> {
    const document = await this.collection.findOne({ _id: challengeId });
    if (!document) {
      return null;
    }
    return {
      challengeId: document._id,
      adminOrganizationId: document.admin_organization_id.toString(),
      challenge: document.challenge,
      expiresAt: fromDate(document.expires_at),
      now: fromDate(document.created_at),
      consumedAt: document.consumed_at === null ? null : fromDate(document.consumed_at),
    };
  }
}
