import type { EntryType } from '../model/value-objects/EntryType.js';

/** A customer as the nightly name rescreen sees it (AML-009). */
export interface ScreeningCustomer {
  /** Same identifier the wallet rescreen and case management use. */
  readonly customerId: string;
  readonly name: string;
  readonly entryType: Exclude<EntryType, 'WALLET'>;
}

/**
 * Outbound port — the customer universe for the name rescreen.
 *
 * Name only: the Finturu customer record carries no identity document, so
 * the customer rescreen matches on names and the document path stays with
 * real-time screening at ingestion, where the document is present.
 */
export interface ScreeningCustomerSource {
  streamCustomers(): AsyncIterable<ScreeningCustomer>;
}
