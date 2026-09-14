import type { IngestedPaymentEvent } from '../model/IngestedPaymentEvent.js';
import type { PaymentProvider } from '../model/value-objects/PaymentProvider.js';

export type EnvelopeMapResult =
  | { status: 'mapped'; event: IngestedPaymentEvent }
  | { status: 'ignored'; reason: 'unknown_event_type' }
  | {
      status: 'failed';
      reason: 'missing_customer' | 'unparsable_amount' | 'unparseable_body';
      /**
       * Set with `missing_customer` when the event names an earlier payment
       * (a Stripe dispute carries only the charge id). The use case can then
       * look up that payment's customer and map again with `hints.customerId`.
       */
      providerReference?: string;
    };

export interface EnvelopeMapHints {
  /** Customer resolved from an earlier payment, used only when the payload itself carries none. */
  readonly customerId?: string;
}

export interface ProviderEnvelopeMapper {
  map(provider: PaymentProvider, payload: unknown, hints?: EnvelopeMapHints): EnvelopeMapResult;
}

/**
 * Finds the customer of an earlier payment. Implemented in the composition
 * root over the payment history, which ingest must not import directly.
 */
export interface PaymentCustomerLookup {
  findCustomerId(organizationId: string, provider: PaymentProvider, providerReference: string): Promise<string | null>;
}
