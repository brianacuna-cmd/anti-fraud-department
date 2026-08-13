import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { AdminOrganization } from '../../../../domain/model/aggregates/AdminOrganization.js';
import type { AdminOrganizationRepository } from '../../../../domain/ports/AdminOrganizationRepository.js';
import type { AdminOrganizationId } from '../../../../domain/model/value-objects/AdminOrganizationId.js';
import type { AdminKeyId } from '../../../../domain/model/value-objects/AdminKeyId.js';
import type { Email } from '../../../../domain/model/value-objects/Email.js';
import type { Instant } from '../../../../../../shared/time/Instant.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { AdminOrganizationDocument } from './documents/AdminOrganizationDocument.js';
import { toDocument, toDomain } from './mappers/AdminOrganizationDocumentMapper.js';

/** Casts the opaque `Transaction` handle back to a real Mongo `ClientSession` (design D6), mirrors MongoOrganizationRepository. */
function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'adminOrganizations';

/**
 * Mongo adapter for `AdminOrganizationRepository` (design D31/D39/D32a).
 */
export class MongoAdminOrganizationRepository implements AdminOrganizationRepository {
  private readonly collection: Collection<AdminOrganizationDocument>;

  constructor(db: Db) {
    this.collection = db.collection<AdminOrganizationDocument>(COLLECTION_NAME);
  }

  async save(admin: AdminOrganization, tx?: Transaction): Promise<void> {
    const document = toDocument(admin);
    await this.collection.replaceOne({ _id: document._id }, document, {
      upsert: true,
      session: toSession(tx),
    });
  }

  async findById(id: AdminOrganizationId): Promise<AdminOrganization | null> {
    const document = await this.collection.findOne({ _id: new ObjectId(id) });
    return document ? toDomain(document) : null;
  }

  async findByEmail(email: Email): Promise<AdminOrganization | null> {
    const document = await this.collection.findOne({ email });
    return document ? toDomain(document) : null;
  }

  /** Exact document count — backs the D43c bootstrap-script guard (`countAll() > 0`). */
  async countAll(): Promise<number> {
    return this.collection.countDocuments({});
  }

  /**
   * Atomic one-time-download claim (design D32a). The filter's `$elemMatch`
   * only matches a document that STILL has a non-null `encryptedPrivateKey`
   * for this exact `keyId` — so a document with an already-claimed (null)
   * ciphertext, or with no such `keyId` at all, never matches, and the
   * `$set` never runs. `returnDocument: 'before'` hands back the ciphertext
   * exactly as it stood immediately prior to this atomic write — the ONE
   * winning concurrent caller gets it; every loser (including an unknown
   * admin/key) gets `null` from a `null` `findOneAndUpdate` result.
   */
  async claimPrivateKey(
    id: AdminOrganizationId,
    keyId: AdminKeyId,
    now: Instant,
    tx?: Transaction,
  ): Promise<string | null> {
    const before = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(id), keys: { $elemMatch: { keyId: new ObjectId(keyId), encryptedPrivateKey: { $ne: null } } } },
      { $set: { 'keys.$.privateKeyDownloadedAt': now, 'keys.$.encryptedPrivateKey': null, updatedAt: now } },
      { returnDocument: 'before', session: toSession(tx) },
    );
    if (!before) {
      return null;
    }
    const claimedKey = before.keys.find((key) => key.keyId.toString() === keyId);
    return claimedKey?.encryptedPrivateKey ?? null;
  }
}
