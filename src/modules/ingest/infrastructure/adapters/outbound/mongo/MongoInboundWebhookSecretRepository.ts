import { ObjectId, type Collection, type Db } from 'mongodb';
import { fromDate, toDate } from '../../../../../../shared/time/Instant.js';
import { InboundWebhookSecret } from '../../../../domain/model/aggregates/InboundWebhookSecret.js';
import { createInboundWebhookSecretId } from '../../../../domain/model/value-objects/InboundWebhookSecretId.js';
import { createPaymentProvider, type PaymentProvider } from '../../../../domain/model/value-objects/PaymentProvider.js';
import type { InboundWebhookSecretRepository } from '../../../../domain/ports/InboundWebhookSecretRepository.js';
import type { InboundWebhookSecretDocument } from './documents/IngestDocuments.js';

const COLLECTION_NAME = 'organization_inbound_webhook_secrets';

export class MongoInboundWebhookSecretRepository implements InboundWebhookSecretRepository {
  private readonly collection: Collection<InboundWebhookSecretDocument>;

  constructor(db: Db) {
    this.collection = db.collection<InboundWebhookSecretDocument>(COLLECTION_NAME);
  }

  async findByOrgProvider(
    organizationId: string,
    provider: PaymentProvider,
  ): Promise<InboundWebhookSecret | null> {
    const document = await this.collection.findOne({
      organization_id: new ObjectId(organizationId),
      provider,
    });
    return document ? toDomain(document) : null;
  }

  async save(secret: InboundWebhookSecret): Promise<void> {
    const document = toDocument(secret);
    await this.collection.replaceOne(
      { organization_id: document.organization_id, provider: document.provider },
      document,
      { upsert: true },
    );
  }
}

function toDocument(secret: InboundWebhookSecret): InboundWebhookSecretDocument {
  return {
    _id: new ObjectId(secret.id),
    organization_id: new ObjectId(secret.organizationId),
    provider: secret.provider,
    ciphertext: secret.ciphertext,
    created_at: toDate(secret.createdAt),
    updated_at: toDate(secret.updatedAt),
  };
}

function toDomain(document: InboundWebhookSecretDocument): InboundWebhookSecret {
  return InboundWebhookSecret.rehydrate({
    id: createInboundWebhookSecretId(document._id.toString()),
    organizationId: document.organization_id.toString(),
    provider: createPaymentProvider(document.provider),
    ciphertext: document.ciphertext,
    createdAt: fromDate(document.created_at),
    updatedAt: fromDate(document.updated_at),
  });
}
