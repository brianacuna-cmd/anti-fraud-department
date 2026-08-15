import type { ProviderIngestEvent } from '../model/aggregates/ProviderIngestEvent.js';
import type { PaymentProvider } from '../model/value-objects/PaymentProvider.js';

export interface ProviderIngestEventRepository {
  insertUnique(event: ProviderIngestEvent): Promise<'inserted' | 'duplicate'>;
  save(event: ProviderIngestEvent): Promise<void>;
  findByOrgProviderEvent(
    organizationId: string,
    provider: PaymentProvider,
    providerEventId: string,
  ): Promise<ProviderIngestEvent | null>;
}
