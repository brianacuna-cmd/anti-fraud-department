import type { ProviderIngestEvent } from '../model/aggregates/ProviderIngestEvent.js';
import type { PaymentProvider } from '../model/value-objects/PaymentProvider.js';
import type { ProviderIngestEventId } from '../model/value-objects/ProviderIngestEventId.js';

export interface ProviderIngestEventRepository {
  insertUnique(event: ProviderIngestEvent): Promise<'inserted' | 'duplicate'>;
  save(event: ProviderIngestEvent): Promise<void>;
  findByOrgProviderEvent(
    organizationId: string,
    provider: PaymentProvider,
    providerEventId: string,
  ): Promise<ProviderIngestEvent | null>;
  findById(id: ProviderIngestEventId): Promise<ProviderIngestEvent | null>;
}
