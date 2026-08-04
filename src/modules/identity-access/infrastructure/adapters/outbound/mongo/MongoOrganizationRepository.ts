import type { Collection, Db } from 'mongodb';
import { buildCursorPage } from '../../../../../../shared/http/pagination.js';
import type { Organization } from '../../../../domain/model/aggregates/Organization.js';
import type {
  OrganizationListPage,
  OrganizationRepository,
} from '../../../../domain/ports/OrganizationRepository.js';
import type { OrganizationId } from '../../../../domain/model/value-objects/OrganizationId.js';
import type { Slug } from '../../../../domain/model/value-objects/Slug.js';
import { organizationSlugTaken } from '../../../../domain/errors/IdentityAccessError.js';
import type { OrganizationDocument } from './documents/OrganizationDocument.js';
import { toDocument, toDomain } from './mappers/OrganizationDocumentMapper.js';
import { extractDuplicateKeyIndexName } from './duplicateKey.js';

const COLLECTION_NAME = 'organizations';
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

  async save(organization: Organization): Promise<void> {
    const document = toDocument(organization);
    try {
      await this.collection.replaceOne({ _id: document._id }, document, { upsert: true });
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

  async findBySlug(slug: Slug): Promise<Organization | null> {
    const document = await this.collection.findOne({ slug });
    return document ? toDomain(document) : null;
  }

  async list(limit: number, cursor?: string): Promise<OrganizationListPage> {
    const filter = cursor ? { _id: { $gt: cursor } } : {};
    const documents = await this.collection.find(filter).sort({ _id: 1 }).limit(limit + 1).toArray();

    const wrapped = documents.map((document) => ({ value: toDomain(document), cursorId: document._id }));
    const page = buildCursorPage(wrapped, limit);
    return { items: page.items.map((entry) => entry.value), nextCursor: page.nextCursor };
  }
}
