import type { ClientSession, Collection, Db } from 'mongodb';
import type { UserRepositoryFactory } from '../../../../domain/ports/UserRepositoryFactory.js';
import type { OrganizationId } from '../../../../domain/model/value-objects/OrganizationId.js';
import type { Email } from '../../../../domain/model/value-objects/Email.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import { MongoUserRepository } from './MongoUserRepository.js';
import type { UserDocument } from './documents/UserDocument.js';

const COLLECTION_NAME = 'Users';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

/**
 * Builds `MongoUserRepository` instances bound to a single tenant (design
 * D8). `existsByEmailAcrossTenants` is the ONE deliberate exception: it
 * queries the whole `users` collection with NO `organizationId` filter,
 * because the atomic bootstrap's brand-new organization can never have any
 * existing users of its own to find a conflict against.
 */
export class MongoUserRepositoryFactory implements UserRepositoryFactory {
  private readonly collection: Collection<UserDocument>;

  constructor(private readonly db: Db) {
    this.collection = db.collection<UserDocument>(COLLECTION_NAME);
  }

  forTenant(organizationId: OrganizationId): MongoUserRepository {
    return new MongoUserRepository(organizationId, this.db);
  }

  async existsByEmailAcrossTenants(email: Email, tx?: Transaction): Promise<boolean> {
    const document = await this.collection.findOne({ Email: email }, { session: toSession(tx) });
    return document !== null;
  }
}
