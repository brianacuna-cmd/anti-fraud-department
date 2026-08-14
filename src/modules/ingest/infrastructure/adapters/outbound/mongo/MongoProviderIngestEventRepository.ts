import { ObjectId, type Collection, type Db } from 'mongodb';
import { fromDate, toDate } from '../../../../../../shared/time/Instant.js';
import { ProviderIngestEvent } from '../../../../domain/model/aggregates/ProviderIngestEvent.js';
import { createProviderIngestEventId } from '../../../../domain/model/value-objects/ProviderIngestEventId.js';
import { createPaymentProvider, type PaymentProvider } from '../../../../domain/model/value-objects/PaymentProvider.js';
import { createProviderIngestStatus } from '../../../../domain/model/value-objects/ProviderIngestStatus.js';
import type { ProviderIngestEventRepository } from '../../../../domain/ports/ProviderIngestEventRepository.js';
import type { ProviderIngestEventDocument } from './documents/IngestDocuments.js';
import {
  extractDuplicateKeyIndexName,
  isDuplicateKeyError,
  PROVIDER_INGEST_EVENT_UNIQUE_INDEX,
} from './duplicateKey.js';

const COLLECTION_NAME = 'provider_ingest_events';

export class MongoProviderIngestEventRepository implements ProviderIngestEventRepository {
  private readonly collection: Collection<ProviderIngestEventDocument>;

  constructor(db: Db) {
    this.collection = db.collection<ProviderIngestEventDocument>(COLLECTION_NAME);
  }

  async insertUnique(event: ProviderIngestEvent): Promise<'inserted' | 'duplicate'> {
    try {
      await this.collection.insertOne(toDocument(event));
      return 'inserted';
    } catch (error) {
      if (isDuplicateIngestEvent(error)) {
        return 'duplicate';
      }
      throw error;
    }
  }

  async save(event: ProviderIngestEvent): Promise<void> {
    const document = toDocument(event);
    await this.collection.replaceOne({ _id: document._id }, document, { upsert: true });
  }

  async findByOrgProviderEvent(
    organizationId: string,
    provider: PaymentProvider,
    providerEventId: string,
  ): Promise<ProviderIngestEvent | null> {
    const document = await this.collection.findOne({
      organization_id: new ObjectId(organizationId),
      provider,
      provider_event_id: providerEventId,
    });
    return document ? toDomain(document) : null;
  }
}

function isDuplicateIngestEvent(error: unknown): boolean {
  if (!isDuplicateKeyError(error)) {
    return false;
  }
  const indexName = extractDuplicateKeyIndexName(error);
  return indexName === undefined || indexName === PROVIDER_INGEST_EVENT_UNIQUE_INDEX;
}

function toDocument(event: ProviderIngestEvent): ProviderIngestEventDocument {
  return {
    _id: new ObjectId(event.id),
    organization_id: new ObjectId(event.organizationId),
    provider: event.provider,
    provider_event_id: event.providerEventId,
    status: event.status,
    created_at: toDate(event.createdAt),
    updated_at: toDate(event.updatedAt),
  };
}

function toDomain(document: ProviderIngestEventDocument): ProviderIngestEvent {
  return ProviderIngestEvent.rehydrate({
    id: createProviderIngestEventId(document._id.toString()),
    organizationId: document.organization_id.toString(),
    provider: createPaymentProvider(document.provider),
    providerEventId: document.provider_event_id,
    status: createProviderIngestStatus(document.status),
    createdAt: fromDate(document.created_at),
    updatedAt: fromDate(document.updated_at),
  });
}
