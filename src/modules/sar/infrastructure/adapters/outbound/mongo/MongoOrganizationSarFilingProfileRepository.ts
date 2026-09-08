import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { OrganizationSarFilingProfile } from '../../../../domain/model/aggregates/OrganizationSarFilingProfile.js';
import type { OrganizationSarFilingProfileRepository } from '../../../../domain/ports/OrganizationSarFilingProfileRepository.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { OrganizationSarFilingProfileDocument } from './documents/OrganizationSarFilingProfileDocument.js';
import { toDocument, toDomain } from './mappers/OrganizationSarFilingProfileDocumentMapper.js';

const COLLECTION_NAME = 'organization_sar_filing_profile';

/** Same opaque-handle unwrap `MongoSarReportRepository` uses. */
function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

/**
 * Mongo adapter for `OrganizationSarFilingProfileRepository`.
 *
 * Keyed on `organization_id`, not `_id`: the aggregate mints a fresh id on
 * first save, and matching on it would insert a second profile for a tenant
 * that already has one. `sar_filing_profile_unique` would then reject the
 * write — correctly, but as a duplicate-key error nobody can act on.
 */
export class MongoOrganizationSarFilingProfileRepository
  implements OrganizationSarFilingProfileRepository
{
  private readonly collection: Collection<OrganizationSarFilingProfileDocument>;

  constructor(db: Db) {
    this.collection = db.collection<OrganizationSarFilingProfileDocument>(COLLECTION_NAME);
  }

  async save(profile: OrganizationSarFilingProfile, tx?: Transaction): Promise<void> {
    const document = toDocument(profile);
    const { _id, organization_id, created_at, ...mutable } = document;
    await this.collection.updateOne(
      { organization_id },
      { $set: mutable, $setOnInsert: { _id, organization_id, created_at } },
      { upsert: true, session: toSession(tx) },
    );
  }

  async findByOrganization(
    organizationId: string,
    tx?: Transaction,
  ): Promise<OrganizationSarFilingProfile | null> {
    const document = await this.collection.findOne(
      { organization_id: new ObjectId(organizationId) },
      { session: toSession(tx) },
    );
    return document ? toDomain(document) : null;
  }
}
