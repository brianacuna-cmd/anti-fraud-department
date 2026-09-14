import type { PaymentCustomerLookup } from '../modules/ingest/domain/ports/ProviderEnvelopeMapper.js';
import type { PaymentActivityRepository } from '../modules/risk-assessment/domain/ports/PaymentActivityRepository.js';

/**
 * Ingest's `PaymentCustomerLookup` over the recorded payment history: a
 * Stripe dispute names a charge, and this finds who that charge belonged to.
 * A charge that arrived before the history existed resolves to `null`.
 */
export function createPaymentCustomerLookup(activities: PaymentActivityRepository): PaymentCustomerLookup {
  return {
    findCustomerId: (organizationId, provider, providerReference) =>
      activities.findCustomerByProviderReference(organizationId, provider, providerReference),
  };
}
