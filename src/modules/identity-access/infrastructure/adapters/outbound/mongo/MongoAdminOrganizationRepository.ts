import type { ClientSession, Collection, Db } from 'mongodb';
import type { AdminOrganization } from '../../../../domain/model/aggregates/AdminOrganization.js';
import type { AdminOrganizationRepository } from '../../../../domain/ports/AdminOrganizationRepository.js';
import type { AdminOrganizationId } from '../../../../domain/model/value-objects/AdminOrganizationId.js';
import type { Email } from '../../../../domain/model/value-objects/Email.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { AdminOrganizationDocument } from './documents/AdminOrganizationDocument.js';
import { toDocument, toDomain } from './mappers/AdminOrganizationDocumentMapper.js';

/** Casts the opaque `Transaction` handle back to a real Mongo `ClientSession` (design D6), mirrors MongoOrganizationRepository. */
function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'adminOrganizations';

/**
 * Mongo adapter for `AdminOrganizationRepository` — PR 1b scope only (design
 * D31/D39). The atomic `claimPrivateKey` CAS (design D32a) is added in
 * PR 2a; this class does not implement it yet.
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
    const document = await this.collection.findOne({ _id: id });
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
}
