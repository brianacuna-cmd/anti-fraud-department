import type { ClientSession, Collection, Db } from 'mongodb';
import type {
  AdminChallengeEntry,
  AdminChallengeRecord,
  AdminChallengeStore,
} from '../../../../domain/ports/AdminChallengeStore.js';
import type { Instant } from '../../../../../../shared/time/Instant.js';
import { fromDate, toDate } from '../../../../../../shared/time/Instant.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { AdminChallengeDocument } from './documents/AdminChallengeDocument.js';

/** Casts the opaque `Transaction` handle back to a real Mongo `ClientSession` (design D6, mirrors MongoMfaChallengeRepository). */
function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'AdminChallenges';

/**
 * Mongo adapter for `AdminChallengeStore` (design super-admin-auth), mirrors
 * `MongoMfaChallengeRepository` exactly. `_id` is the `challengeId`, so
 * `append`'s `insertOne` alone enforces uniqueness — no separate unique
 * index needed. `consume` is the ATOMIC compare-and-set the challenge
 * verification flow relies on for replay-safety.
 */
export class MongoAdminChallengeRepository implements AdminChallengeStore {
  private readonly collection: Collection<AdminChallengeDocument>;

  constructor(db: Db) {
    this.collection = db.collection<AdminChallengeDocument>(COLLECTION_NAME);
  }

  async append(record: AdminChallengeRecord, tx?: Transaction): Promise<void> {
    const document: AdminChallengeDocument = {
      _id: record.challengeId,
      AdminOrganizationId: record.adminOrganizationId,
      Challenge: record.challenge,
      ExpiresAt: record.expiresAt,
      ExpiresAtDate: toDate(record.expiresAt),
      ConsumedAt: null,
      CreatedAt: record.now,
    };
    await this.collection.insertOne(document, { session: toSession(tx) });
  }

  /**
   * Atomic compare-and-set: the filter matches ONLY a row that is still
   * unconsumed AND unexpired (`ExpiresAt: {$gt: now}`, ISO-8601 UTC strings
   * compare correctly lexically) — `modifiedCount === 1` is decided by
   * COMMITTED state, never a prior read, so exactly one concurrent caller
   * ever wins.
   */
  async consume(challengeId: string, now: Instant, tx?: Transaction): Promise<boolean> {
    const result = await this.collection.updateOne(
      { _id: challengeId, ConsumedAt: null, ExpiresAt: { $gt: now } },
      { $set: { ConsumedAt: now } },
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
      adminOrganizationId: document.AdminOrganizationId,
      challenge: document.Challenge,
      expiresAt: document.ExpiresAt as Instant,
      now: fromDate(new Date(document.CreatedAt)),
      consumedAt: document.ConsumedAt as Instant | null,
    };
  }
}
