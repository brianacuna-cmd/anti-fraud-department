import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { Session } from '../../../../domain/model/aggregates/Session.js';
import type { SessionActorRef, SessionRepository } from '../../../../domain/ports/SessionRepository.js';
import type { SessionId } from '../../../../domain/model/value-objects/SessionId.js';
import type { OrganizationId } from '../../../../domain/model/value-objects/OrganizationId.js';
import { toDate, type Instant } from '../../../../../../shared/time/Instant.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { SessionDocument } from './documents/SessionDocument.js';
import { toDocument, toDomain } from './mappers/SessionDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'sessions';

export class MongoSessionRepository implements SessionRepository {
  private readonly collection: Collection<SessionDocument>;

  constructor(db: Db) {
    this.collection = db.collection<SessionDocument>(COLLECTION_NAME);
  }

  async save(session: Session, tx?: Transaction): Promise<void> {
    const document = toDocument(session);
    await this.collection.replaceOne({ _id: document._id }, document, {
      upsert: true,
      session: toSession(tx),
    });
  }

  async findById(id: SessionId, tx?: Transaction): Promise<Session | null> {
    const document = await this.collection.findOne({ _id: new ObjectId(id) }, { session: toSession(tx) });
    return document ? toDomain(document) : null;
  }

  async findByTokenHash(hash: string): Promise<Session | null> {
    const document = await this.collection.findOne({ token_hash: hash });
    return document ? toDomain(document) : null;
  }

  async revokeSession(id: SessionId, revokedAt: Instant, tx?: Transaction): Promise<void> {
    const at = toDate(revokedAt);
    await this.collection.updateOne(
      { _id: new ObjectId(id), deleted_at: null },
      { $set: { deleted_at: at } },
      { session: toSession(tx) },
    );
  }

  async revokeAllForOrganization(id: OrganizationId, at: Instant, tx?: Transaction): Promise<number> {
    const when = toDate(at);
    const result = await this.collection.updateMany(
      { organization_id: new ObjectId(id), deleted_at: null },
      { $set: { deleted_at: when } },
      { session: toSession(tx) },
    );
    return result.modifiedCount;
  }

  async revokeAllForActor(actor: SessionActorRef, at: Instant, tx?: Transaction): Promise<number> {
    const when = toDate(at);
    const filter =
      actor.actorType === 'ORGANIZATION'
        ? { organization_id: new ObjectId(actor.organizationId), user_id: null, deleted_at: null }
        : actor.actorType === 'PLATFORM_ADMIN'
          ? { admin_organization_id: new ObjectId(actor.adminOrganizationId), deleted_at: null }
          : { user_id: new ObjectId(actor.userId), deleted_at: null };
    const result = await this.collection.updateMany(filter, { $set: { deleted_at: when } }, {
      session: toSession(tx),
    });
    return result.modifiedCount;
  }
}
