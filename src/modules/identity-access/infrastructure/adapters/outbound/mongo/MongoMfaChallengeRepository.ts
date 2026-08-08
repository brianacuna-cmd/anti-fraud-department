import type { ClientSession, Collection, Db } from 'mongodb';
import type {
  MfaChallengeRecord,
  MfaChallengeStore,
} from '../../../../domain/ports/MfaChallengeStore.js';
import type { Instant } from '../../../../../../shared/time/Instant.js';
import { toDate } from '../../../../../../shared/time/Instant.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { MfaChallengeDocument } from './documents/MfaChallengeDocument.js';

/** Casts the opaque `Transaction` handle back to a real Mongo `ClientSession` (design D6, mirrors MongoSessionRepository). */
function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'MfaChallenges';

/**
 * Mongo adapter for `MfaChallengeStore` (design D1, two-step-login). `_id` is
 * the token's `jti`, so `append`'s `insertOne` alone enforces uniqueness —
 * no separate unique index needed. `consume` is the ATOMIC compare-and-set a
 * later transactional mint (`IssueSession`/`ActivateMfa`, PR1b/2/3) relies on
 * for replay-safety — the exact same shape as `MongoSessionRepository.
 * markRotated` (design D15), applied to jti consumption instead of rotation.
 */
export class MongoMfaChallengeRepository implements MfaChallengeStore {
  private readonly collection: Collection<MfaChallengeDocument>;

  constructor(db: Db) {
    this.collection = db.collection<MfaChallengeDocument>(COLLECTION_NAME);
  }

  async append(record: MfaChallengeRecord, tx?: Transaction): Promise<void> {
    const document: MfaChallengeDocument = {
      _id: record.jti,
      UserId: record.userId,
      OrganizationId: record.organizationId,
      ActorType: record.actorType,
      TokenType: record.tokenType,
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
   * compare correctly lexically, same convention as the rest of this repo's
   * `Instant` fields) — `modifiedCount === 1` is decided by COMMITTED state,
   * never a prior read, so exactly one concurrent caller ever wins.
   */
  async consume(jti: string, now: Instant, tx?: Transaction): Promise<boolean> {
    const result = await this.collection.updateOne(
      { _id: jti, ConsumedAt: null, ExpiresAt: { $gt: now } },
      { $set: { ConsumedAt: now } },
      { session: toSession(tx) },
    );
    return result.modifiedCount === 1;
  }
}
