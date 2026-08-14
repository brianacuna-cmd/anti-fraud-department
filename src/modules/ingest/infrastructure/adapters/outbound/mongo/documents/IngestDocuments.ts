import type { ObjectId } from 'mongodb';
import type { PaymentProvider } from '../../../../domain/model/value-objects/PaymentProvider.js';

export interface ProviderIngestEventDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly provider: PaymentProvider;
  readonly provider_event_id: string;
  readonly status: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface InboundWebhookSecretDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly provider: PaymentProvider;
  readonly ciphertext: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}
