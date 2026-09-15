/**
 * Outbound port: what the providers would have sent by webhook, fetched on
 * demand (through api-business). Objects come raw, shaped as the provider's
 * webhook payload, so they go through the same mapping.
 */
export interface StripeEventPage {
  /** Stripe events, oldest first; Connect events carry `account`. */
  readonly items: readonly Record<string, unknown>[];
  /** `created` (Unix seconds) of the newest event returned, or the `since` asked for. */
  readonly until: number;
  /** More events were left out: the next poll continues from `until`. */
  readonly truncated: boolean;
}

export interface BridgeTransferPage {
  /** Bridge transfer objects updated after `since`, oldest update first. */
  readonly items: readonly Record<string, unknown>[];
  /** `updated_at` (ISO) of the newest transfer returned, or the `since` asked for. */
  readonly until: string;
  readonly truncated: boolean;
}

export interface ProviderEventFeed {
  stripeEventsSince(sinceUnixSeconds: number): Promise<StripeEventPage>;
  /** `createdAfter` bounds how far back transfers are walked (Bridge lists newest first). */
  bridgeTransfersSince(sinceIso: string, createdAfterIso: string): Promise<BridgeTransferPage>;
}

export type PollFeed = 'stripe-events' | 'bridge-transfers';

/** Where each feed was left, per organization. */
export interface PollCursorRepository {
  get(organizationId: string, feed: PollFeed): Promise<string | null>;
  save(organizationId: string, feed: PollFeed, cursor: string): Promise<void>;
}
