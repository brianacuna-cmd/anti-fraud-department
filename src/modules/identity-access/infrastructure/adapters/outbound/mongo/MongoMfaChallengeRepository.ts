import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type {
  MfaChallengeRecord,
  MfaChallengeStore,
} from '../../../../domain/ports/MfaChallengeStore.js';
import { toDate, type Instant } from '../../../../../../shared/time/Instant.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { MfaChallengeDocument } from './documents/MfaChallengeDocument.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'mfa_challenges';

export class MongoMfaChallengeRepository implements MfaChallengeStore {
  private readonly collection: Collection<MfaChallengeDocument>;

  constructor(db: Db) {
    this.collection = db.collection<MfaChallengeDocument>(COLLECTION_NAME);
  }

  async append(record: MfaChallengeRecord, tx?: Transaction): Promise<void> {
    const document: MfaChallengeDocument = {
      _id: record.jti,
      user_id: new ObjectId(record.userId),
      organization_id: record.organizationId === null ? null : new ObjectId(record.organizationId),
      actor_type: record.actorType,
      token_type: record.tokenType,
      expires_at: toDate(record.expiresAt),
      consumed_at: null,
      created_at: toDate(record.now),
    };
    await this.collection.insertOne(document, { session: toSession(tx) });
  }

  async consume(jti: string, now: Instant, tx?: Transaction): Promise<boolean> {
    const result = await this.collection.updateOne(
      { _id: jti, consumed_at: null, expires_at: { $gt: toDate(now) } },
      { $set: { consumed_at: toDate(now) } },
      { session: toSession(tx) },
    );
    return result.modifiedCount === 1;
  }
}
