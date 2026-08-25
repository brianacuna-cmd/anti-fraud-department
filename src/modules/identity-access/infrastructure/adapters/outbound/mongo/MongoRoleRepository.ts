import type { Collection, Db } from 'mongodb';
import type { RoleId } from '../../../../domain/model/value-objects/RoleId.js';
import { isAssignableUserRole } from '../../../../domain/model/value-objects/RoleId.js';
import type { RoleRepository, RoleView } from '../../../../domain/ports/RoleRepository.js';
import type { RoleDocument } from './documents/RoleDocument.js';
import { toDomain } from './mappers/RoleDocumentMapper.js';

const COLLECTION_NAME = 'roles';

/**
 * Mongo adapter for `RoleRepository` (design "3. `RoleRepository` port"),
 * mirrors `MongoAdminOrganizationRepository`'s shape. `isAssignableToUser`
 * composes a runtime existence/Active/not-deleted check AND the
 * `ASSIGNABLE_USER_ROLES` helper — defense in depth, same rule enforced in
 * the `RoleId` VO layer.
 */
export class MongoRoleRepository implements RoleRepository {
  private readonly collection: Collection<RoleDocument>;

  constructor(db: Db) {
    this.collection = db.collection<RoleDocument>(COLLECTION_NAME);
  }

  async findById(id: RoleId): Promise<RoleView | null> {
    const document = await this.collection.findOne({ _id: id });
    return document ? toDomain(document) : null;
  }

  async exists(id: RoleId): Promise<boolean> {
    const count = await this.collection.countDocuments({ _id: id }, { limit: 1 });
    return count > 0;
  }

  async isAssignableToUser(id: RoleId): Promise<boolean> {
    if (!isAssignableUserRole(id)) {
      return false;
    }
    const count = await this.collection.countDocuments(
      { _id: id, status: 'ACTIVE', deleted_at: null },
      { limit: 1 },
    );
    return count > 0;
  }
}
