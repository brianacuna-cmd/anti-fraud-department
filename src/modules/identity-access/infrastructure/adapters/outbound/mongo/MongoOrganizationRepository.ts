import type { ClientSession, Collection, Db } from 'mongodb';
import { buildCursorPage } from '../../../../../../shared/http/pagination.js';
import type { Organization } from '../../../../domain/model/aggregates/Organization.js';
import type {
  OrganizationListPage,
  OrganizationRepository,
} from '../../../../domain/ports/OrganizationRepository.js';
import type { OrganizationId } from '../../../../domain/model/value-objects/OrganizationId.js';
import type { Slug } from '../../../../domain/model/value-objects/Slug.js';
import type { Email } from '../../../../domain/model/value-objects/Email.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import { organizationSlugTaken } from '../../../../domain/errors/IdentityAccessError.js';
import type { OrganizationDocument } from './documents/OrganizationDocument.js';
import { toDocument, toDomain } from './mappers/OrganizationDocumentMapper.js';
import { extractDuplicateKeyIndexName } from './duplicateKey.js';

/** Casts the opaque `Transaction` handle back to a real Mongo `ClientSession` (design D6). */
function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'Organizations';
const SLUG_UNIQUE_INDEX_NAME = 'slug_unique';

/**
 * Mongo adapter for `OrganizationRepository` (design D7: no `TenantContext`
 * binding — organizations are the tenant root).
 */
export class MongoOrganizationRepository implements OrganizationRepository {
  private readonly collection: Collection<OrganizationDocument>;

  constructor(db: Db) {
    this.collection = db.collection<OrganizationDocument>(COLLECTION_NAME);
  }

  async save(organization: Organization, tx?: Transaction): Promise<void> {
    const document = toDocument(organization);
    try {
      await this.collection.replaceOne({ _id: document._id }, document, {
        upsert: true,
        session: toSession(tx),
      });
    } catch (error) {
      if (extractDuplicateKeyIndexName(error) === SLUG_UNIQUE_INDEX_NAME) {
        throw organizationSlugTaken(organization.slug);
      }
      throw error;
    }
  }

  async findById(id: OrganizationId): Promise<Organization | null> {
    const document = await this.collection.findOne({ _id: id });
    return document ? toDomain(document) : null;
  }

  async findBySlug(slug: Slug, tx?: Transaction): Promise<Organization | null> {
    const document = await this.collection.findOne({ Slug: slug }, { session: toSession(tx) });
    return document ? toDomain(document) : null;
  }

  async findByEmail(email: Email): Promise<Organization | null> {
    const document = await this.collection.findOne({ Email: email });
    return document ? toDomain(document) : null;
  }

  async list(limit: number, cursor?: string): Promise<OrganizationListPage> {
    const filter = cursor ? { _id: { $gt: cursor } } : {};
    const documents = await this.collection.find(filter).sort({ _id: 1 }).limit(limit + 1).toArray();

    const wrapped = documents.map((document) => ({ value: toDomain(document), cursorId: document._id.toString() }));
    const page = buildCursorPage(wrapped, limit);
    return { items: page.items.map((entry) => entry.value), nextCursor: page.nextCursor };
  }
}
