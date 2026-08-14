import type { InboundWebhookSecret } from '../model/aggregates/InboundWebhookSecret.js';
import type { PaymentProvider } from '../model/value-objects/PaymentProvider.js';

export interface InboundWebhookSecretRepository {
  findByOrgProvider(
    organizationId: string,
    provider: PaymentProvider,
  ): Promise<InboundWebhookSecret | null>;
  save(secret: InboundWebhookSecret): Promise<void>;
}
