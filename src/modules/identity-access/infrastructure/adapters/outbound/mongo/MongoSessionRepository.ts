import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { Session } from '../../../../domain/model/aggregates/Session.js';
import type { SessionActorRef, SessionRepository } from '../../../../domain/ports/SessionRepository.js';
import type { SessionId } from '../../../../domain/model/value-objects/SessionId.js';
import type { FamilyId } from '../../../../domain/model/value-objects/FamilyId.js';
import type { OrganizationId } from '../../../../domain/model/value-objects/OrganizationId.js';
import type { Instant } from '../../../../../../shared/time/Instant.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { SessionDocument } from './documents/SessionDocument.js';
import { toDocument, toDomain } from './mappers/SessionDocumentMapper.js';

/** Casts the opaque `Transaction` handle back to a real Mongo `ClientSession` (design D6). */
function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'Sessions';

/**
 * Mongo adapter for `SessionRepository` (design D14, D15, D27, D28, D38).
 * Not tenant-bound, unlike `MongoUserRepository` — a session lookup by
 * token hash has no tenant to scope by until AFTER the row resolves.
 */
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

  async findByTokenHash(hash: string): Promise<Session | null> {
    const document = await this.collection.findOne({ TokenHash: hash });
    return document ? toDomain(document) : null;
  }

  async findByRefreshTokenHash(hash: string, tx?: Transaction): Promise<Session | null> {
    const document = await this.collection.findOne({ RefreshTokenHash: hash }, { session: toSession(tx) });
    return document ? toDomain(document) : null;
  }

  /**
   * Atomic compare-and-set (design D15): the filter only matches a row whose
   * `RotatedAt` is still `null`, so `modifiedCount === 1` is decided by
   * COMMITTED state, never a prior read. The CAS loser gets `false` and must
   * re-read to take the grace/theft branch.
   */
  async markRotated(id: SessionId, rotatedAt: Instant, tx?: Transaction): Promise<boolean> {
    const result = await this.collection.updateOne(
      { _id: new ObjectId(id), RotatedAt: null },
      { $set: { RotatedAt: rotatedAt, UpdatedAt: rotatedAt } },
      { session: toSession(tx) },
    );
    return result.modifiedCount === 1;
  }

  /** Unsessioned by design (D16) — must survive the triggering request's own rollback. */
  async revokeFamily(familyId: FamilyId, revokedAt: Instant): Promise<number> {
    const result = await this.collection.updateMany(
      { FamilyId: new ObjectId(familyId), DeletedAt: null },
      { $set: { DeletedAt: revokedAt, UpdatedAt: revokedAt } },
    );
    return result.modifiedCount;
  }

  /** Sets `deletedAt` on exactly the given session (Phase 4 — `Logout`). A no-op for an unknown or already-revoked id. */
  async revokeSession(id: SessionId, revokedAt: Instant, tx?: Transaction): Promise<void> {
    await this.collection.updateOne(
      { _id: new ObjectId(id), DeletedAt: null },
      { $set: { DeletedAt: revokedAt, UpdatedAt: revokedAt } },
      { session: toSession(tx) },
    );
  }

  async revokeAllForOrganization(id: OrganizationId, at: Instant, tx?: Transaction): Promise<number> {
    const result = await this.collection.updateMany(
      { OrganizationId: new ObjectId(id), DeletedAt: null },
      { $set: { DeletedAt: at, UpdatedAt: at } },
      { session: toSession(tx) },
    );
    return result.modifiedCount;
  }

  async revokeAllForActor(actor: SessionActorRef, at: Instant, tx?: Transaction): Promise<number> {
    const filter =
      actor.actorType === 'ORGANIZATION'
        ? { ActorType: 'ORGANIZATION', OrganizationId: new ObjectId(actor.organizationId), DeletedAt: null }
        : { ActorType: actor.actorType, UserId: new ObjectId(actor.userId), DeletedAt: null };
    const result = await this.collection.updateMany(filter, { $set: { DeletedAt: at, UpdatedAt: at } }, {
      session: toSession(tx),
    });
    return result.modifiedCount;
  }
}
