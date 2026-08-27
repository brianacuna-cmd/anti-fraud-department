import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { CustomerWebhookSubscription } from '../../../../domain/model/aggregates/CustomerWebhookSubscription.js';
import type { CustomerWebhookSubscriptionId } from '../../../../domain/model/value-objects/CustomerWebhookSubscriptionId.js';
import type { CustomerWebhookSubscriptionRepository } from '../../../../domain/ports/CustomerWebhookSubscriptionRepository.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import { webhookSubscriptionUrlTaken } from '../../../../domain/errors/CaseManagementError.js';
import { isDuplicateKeyError } from '../../../../../../shared/persistence/mongo/duplicateKey.js';
import type { CustomerWebhookSubscriptionDocument } from './documents/CustomerWebhookSubscriptionDocument.js';
import { toDocument, toDomain } from './mappers/CustomerWebhookSubscriptionDocumentMapper.js';

/** Casts the opaque `Transaction` handle back to a real Mongo `ClientSession`. */
function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'customer_webhook_subscriptions';

function duplicateUrlOrRethrow(error: unknown, url: string): never {
  if (isDuplicateKeyError(error)) {
    throw webhookSubscriptionUrlTaken(url);
  }
  throw error;
}

/**
 * Mongo adapter for `CustomerWebhookSubscriptionRepository`. Unique
 * `(organization_id, url)` includes inactive rows; E11000 maps to
 * `WEBHOOK_SUBSCRIPTION_URL_TAKEN`. Delete is a hard `deleteOne`.
 */
export class MongoCustomerWebhookSubscriptionRepository implements CustomerWebhookSubscriptionRepository {
  private readonly collection: Collection<CustomerWebhookSubscriptionDocument>;

  constructor(db: Db) {
    this.collection = db.collection<CustomerWebhookSubscriptionDocument>(COLLECTION_NAME);
  }

  async create(subscription: CustomerWebhookSubscription, tx?: Transaction): Promise<void> {
    try {
      await this.collection.insertOne(toDocument(subscription), { session: toSession(tx) });
    } catch (error) {
      throw duplicateUrlOrRethrow(error, subscription.url);
    }
  }

  async save(subscription: CustomerWebhookSubscription, tx?: Transaction): Promise<void> {
    const document = toDocument(subscription);
    try {
      await this.collection.replaceOne({ _id: document._id }, document, { session: toSession(tx) });
    } catch (error) {
      throw duplicateUrlOrRethrow(error, subscription.url);
    }
  }

  async delete(id: CustomerWebhookSubscriptionId, tx?: Transaction): Promise<void> {
    await this.collection.deleteOne({ _id: new ObjectId(id) }, { session: toSession(tx) });
  }

  async findById(
    id: CustomerWebhookSubscriptionId,
    tx?: Transaction,
  ): Promise<CustomerWebhookSubscription | null> {
    const document = await this.collection.findOne({ _id: new ObjectId(id) }, { session: toSession(tx) });
    return document ? toDomain(document) : null;
  }

  async findByUrlForOrg(
    organizationId: string,
    url: string,
    tx?: Transaction,
  ): Promise<CustomerWebhookSubscription | null> {
    const document = await this.collection.findOne(
      { organization_id: new ObjectId(organizationId), url },
      { session: toSession(tx) },
    );
    return document ? toDomain(document) : null;
  }

  async listByOrganization(
    organizationId: string,
    filter?: { readonly active?: boolean },
    tx?: Transaction,
  ): Promise<readonly CustomerWebhookSubscription[]> {
    const documents = await this.collection
      .find(listFilter(organizationId, filter), { session: toSession(tx) })
      .sort({ created_at: 1 })
      .toArray();
    return documents.map(toDomain);
  }
}

function listFilter(
  organizationId: string,
  filter?: { readonly active?: boolean },
): { organization_id: ObjectId; active?: boolean } {
  if (filter?.active === undefined) {
    return { organization_id: new ObjectId(organizationId) };
  }
  return { organization_id: new ObjectId(organizationId), active: filter.active };
}
