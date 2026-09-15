import { fromDate, type Instant } from '../../../src/shared/time/Instant.js';
import {
  PaymentActivity,
  type CreatePaymentActivityInput,
} from '../../../src/modules/risk-assessment/domain/model/aggregates/PaymentActivity.js';
import { generatePaymentActivityId } from '../../../src/modules/risk-assessment/domain/model/value-objects/PaymentActivityId.js';
import { oid } from '../../support/oid.js';

export const ANCHOR = fromDate(new Date('2026-03-10T12:00:00.000Z'));

/** `hours` before ANCHOR (negative = after it). */
export function hoursBefore(hours: number, anchor: Instant = ANCHOR): Instant {
  return fromDate(new Date(new Date(anchor).getTime() - hours * 3_600_000));
}

let sequence = 0;

export function activity(overrides: Partial<CreatePaymentActivityInput> = {}): PaymentActivity {
  sequence += 1;
  return PaymentActivity.create({
    id: generatePaymentActivityId(),
    organizationId: oid('org-1'),
    customerId: 'cus_1',
    provider: 'stripe',
    providerEventId: `evt_${sequence}`,
    providerReference: `ch_${sequence}`,
    providerEventType: 'charge.succeeded',
    kind: 'ATTEMPT',
    outcome: 'SUCCEEDED',
    amountCents: 1000,
    currency: 'usd',
    declineCategory: null,
    cardCountry: 'US',
    billingCountry: 'US',
    source: 'WEBHOOK',
    occurredAt: hoursBefore(1),
    recordedAt: ANCHOR,
    ...overrides,
  });
}

/**
 * One customer history that exercises every window edge. Shared by the
 * domain reference test and the Mongo adapter test so both implementations
 * are held to the same expectations.
 */
export function windowScenario(): { rows: PaymentActivity[]; expected: Record<string, unknown> } {
  const rows = [
    activity({ occurredAt: hoursBefore(1), cardCountry: 'US' }),
    // 6 minutes before: inside the 10 min velocity window too.
    activity({ occurredAt: hoursBefore(0.1), outcome: 'FAILED', providerEventType: 'charge.failed', declineCategory: 'FRAUD_SUSPECTED', cardCountry: 'NG' }),
    activity({ occurredAt: hoursBefore(3), outcome: 'FAILED', providerEventType: 'charge.failed', declineCategory: 'INSUFFICIENT_FUNDS', cardCountry: 'NG' }),
    activity({ occurredAt: hoursBefore(23.9), outcome: 'FAILED', providerEventType: 'charge.failed', declineCategory: 'AUTHENTICATION_FAILED', cardCountry: null }),
    // Exactly 24 h before: OUT of the 24 h window (it is `(anchor - 24h, anchor]`).
    activity({ occurredAt: hoursBefore(24), cardCountry: 'BR' }),
    activity({ occurredAt: hoursBefore(24 * 30), kind: 'CHARGEBACK', outcome: null, providerEventType: 'charge.dispute.created' }),
    activity({ occurredAt: hoursBefore(24 * 91), kind: 'CHARGEBACK', outcome: null, providerEventType: 'charge.dispute.created' }),
    activity({ occurredAt: hoursBefore(24 * 10), kind: 'FRAUD_WARNING', outcome: null, providerEventType: 'radar.early_fraud_warning.created' }),
    activity({ occurredAt: hoursBefore(24 * 200) }),
    // After the anchor: must be ignored entirely.
    activity({ occurredAt: hoursBefore(-1), outcome: 'FAILED', providerEventType: 'charge.failed' }),
    // Another customer: must never leak in.
    activity({ customerId: 'cus_other', occurredAt: hoursBefore(1) }),
  ];
  return {
    rows,
    expected: {
      attempts24h: 4,
      failedAttempts24h: 3,
      failedAttempts10m: 1,
      suspiciousDeclines24h: 2,
      distinctCardCountries24h: 2,
      chargebacks90d: 1,
      fraudWarnings90d: 1,
      lifetimeAttempts: 6,
      lifetimeChargebacks: 2,
      firstActivityAt: hoursBefore(24 * 200),
    },
  };
}

/**
 * One payment link and one merchant, across several customers, for the
 * event-scoped counts. Shared by the domain reference and the Mongo adapter.
 */
export function contextScenario(): { rows: PaymentActivity[]; expected: Record<string, number> } {
  const failed = (overrides: Partial<CreatePaymentActivityInput>) =>
    activity({ outcome: 'FAILED', providerEventType: 'charge.failed', merchantId: 'acct_seller', ...overrides });
  const rows = [
    // pi_link: 3 suspicious failures and 3 distinct cards (one card twice), from two customers.
    failed({ relatedReferences: ['pi_link'], declineCategory: 'FRAUD_SUSPECTED', cardFingerprint: 'fp_a', occurredAt: hoursBefore(1) }),
    failed({ relatedReferences: ['pi_link'], declineCategory: 'AUTHENTICATION_FAILED', cardFingerprint: 'fp_b', occurredAt: hoursBefore(2) }),
    failed({ customerId: 'cus_2', relatedReferences: ['pi_link'], declineCategory: 'FRAUD_SUSPECTED', cardFingerprint: 'fp_c', occurredAt: hoursBefore(3) }),
    failed({ relatedReferences: ['pi_link'], declineCategory: 'INSUFFICIENT_FUNDS', cardFingerprint: 'fp_a', occurredAt: hoursBefore(4) }),
    activity({ relatedReferences: ['pi_link'], cardFingerprint: null, merchantId: 'acct_seller', occurredAt: hoursBefore(5) }),
    // After the anchor: ignored.
    failed({ relatedReferences: ['pi_link'], declineCategory: 'FRAUD_SUSPECTED', cardFingerprint: 'fp_z', occurredAt: hoursBefore(-1) }),
    // pi_two: 3 failures in 30 days -> a second repeatedly failing link of the seller.
    failed({ relatedReferences: ['pi_two'], occurredAt: hoursBefore(24) }),
    failed({ relatedReferences: ['pi_two'], occurredAt: hoursBefore(48) }),
    failed({ relatedReferences: ['pi_two'], occurredAt: hoursBefore(24 * 29) }),
    // pi_old: 3 failures but one is older than 30 days -> does not count.
    failed({ relatedReferences: ['pi_old'], occurredAt: hoursBefore(24) }),
    failed({ relatedReferences: ['pi_old'], occurredAt: hoursBefore(48) }),
    failed({ relatedReferences: ['pi_old'], occurredAt: hoursBefore(24 * 31) }),
    // Another seller's link: never counted for acct_seller.
    failed({ relatedReferences: ['pi_else'], merchantId: 'acct_else', occurredAt: hoursBefore(1) }),
    failed({ relatedReferences: ['pi_else'], merchantId: 'acct_else', occurredAt: hoursBefore(2) }),
    failed({ relatedReferences: ['pi_else'], merchantId: 'acct_else', occurredAt: hoursBefore(3) }),
  ];
  return {
    rows,
    expected: { linkSuspiciousDeclines: 3, linkDistinctCards: 3, merchantLinksWithRepeatedFailures: 2 },
  };
}
