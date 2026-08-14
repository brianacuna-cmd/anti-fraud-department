import type { IngestedPaymentEvent } from '../model/IngestedPaymentEvent.js';
import type { PaymentProvider } from '../model/value-objects/PaymentProvider.js';

export type EnvelopeMapResult =
  | { status: 'mapped'; event: IngestedPaymentEvent }
  | { status: 'ignored'; reason: 'unknown_event_type' }
  | { status: 'failed'; reason: 'missing_customer' | 'unparsable_amount' };

export interface ProviderEnvelopeMapper {
  map(provider: PaymentProvider, payload: unknown): EnvelopeMapResult;
}
