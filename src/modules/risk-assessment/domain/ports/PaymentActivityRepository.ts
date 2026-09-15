import type { Instant } from '../../../../shared/time/Instant.js';
import type { PaymentActivity } from '../model/aggregates/PaymentActivity.js';
import type { PaymentActivitySummary } from '../model/CustomerRiskContext.js';
import type { MerchantActivitySummary } from '../model/MerchantRisk.js';

/** Outbound port for the customer payment history (`payment_activities`). */
export interface PaymentActivityRepository {
  /**
   * Append-only insert, idempotent on (organization, provider, providerEventId):
   * a redelivered event reports `duplicate` instead of counting twice.
   */
  record(activity: PaymentActivity): Promise<'inserted' | 'duplicate'>;

  /**
   * See `summarizePaymentActivity` for the exact window semantics. Several
   * ids when one customer is known under several providers (a case carries
   * the Finturu, Stripe and Bridge ids); their rows are summarized together.
   */
  summarize(organizationId: string, customerIds: readonly string[], anchor: Instant): Promise<PaymentActivitySummary>;

  /** Most recent first, for the case file panel. */
  listRecent(organizationId: string, customerIds: readonly string[], limit: number): Promise<readonly PaymentActivity[]>;

  /**
   * Payments RECEIVED by a merchant in the 90 days up to `anchor`. Several ids
   * because a merchant is known by its Finturu user id and its Stripe account.
   * See `summarizeMerchantActivity`.
   */
  summarizeMerchant(organizationId: string, merchantIds: readonly string[], anchor: Instant): Promise<MerchantActivitySummary>;

  /**
   * The customer that owns an earlier payment. A Stripe dispute only carries
   * the charge id, so this is how a chargeback finds whose it is.
   */
  findCustomerByProviderReference(
    organizationId: string,
    provider: string,
    providerReference: string,
  ): Promise<string | null>;
}
