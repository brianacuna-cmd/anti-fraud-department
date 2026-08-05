import type { ClientSession, Collection, Db } from 'mongodb';
import { buildCursorPage } from '../../../../../../shared/http/pagination.js';
import type { User } from '../../../../domain/model/aggregates/User.js';
import type { UserListPage, UserRepository } from '../../../../domain/ports/UserRepository.js';
import type { UserId } from '../../../../domain/model/value-objects/UserId.js';
import type { OrganizationId } from '../../../../domain/model/value-objects/OrganizationId.js';
import type { Email } from '../../../../domain/model/value-objects/Email.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import { userEmailTaken } from '../../../../domain/errors/IdentityAccessError.js';
import type { UserDocument } from './documents/UserDocument.js';
import { toDocument, toDomain } from './mappers/UserDocumentMapper.js';
import { extractDuplicateKeyIndexName } from './duplicateKey.js';

const COLLECTION_NAME = 'users';
const USER_EMAIL_UNIQUE_INDEX_NAME = 'user_email_unique';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

/**
 * Mongo adapter for `UserRepository`, bound to a single tenant (design D7/D8)
 * — every query implicitly filters by the `organizationId` it was
 * constructed with, so a query built without a tenant has no way to omit
 * that filter.
 */
export class MongoUserRepository implements UserRepository {
  private readonly collection: Collection<UserDocument>;

  constructor(
    private readonly organizationId: OrganizationId,
    db: Db,
  ) {
    this.collection = db.collection<UserDocument>(COLLECTION_NAME);
  }

  async save(user: User, tx?: Transaction): Promise<void> {
    const document = toDocument(user);
    try {
      await this.collection.replaceOne({ _id: document._id }, document, {
        upsert: true,
        session: toSession(tx),
      });
    } catch (error) {
      if (extractDuplicateKeyIndexName(error) === USER_EMAIL_UNIQUE_INDEX_NAME) {
        throw userEmailTaken(user.email);
      }
      throw error;
    }
  }

  async findById(id: UserId): Promise<User | null> {
    const document = await this.collection.findOne({ _id: id, organizationId: this.organizationId });
    return document ? toDomain(document) : null;
  }

  async findByEmail(email: Email): Promise<User | null> {
    const document = await this.collection.findOne({ email, organizationId: this.organizationId });
    return document ? toDomain(document) : null;
  }

  async list(limit: number, cursor?: string): Promise<UserListPage> {
    const filter = cursor
      ? { organizationId: this.organizationId, _id: { $gt: cursor } }
      : { organizationId: this.organizationId };
    const documents = await this.collection.find(filter).sort({ _id: 1 }).limit(limit + 1).toArray();

    const wrapped = documents.map((document) => ({ value: toDomain(document), cursorId: document._id }));
    const page = buildCursorPage(wrapped, limit);
    return { items: page.items.map((entry) => entry.value), nextCursor: page.nextCursor };
  }
}
