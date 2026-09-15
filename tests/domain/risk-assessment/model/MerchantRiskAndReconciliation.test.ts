import {
  assessMerchantRisk,
  levelOf,
  summarizeMerchantActivity,
  type MerchantRiskInput,
} from '../../../../src/modules/risk-assessment/domain/model/MerchantRisk.js';
import {
  reconcilePaymentLinks,
  type PaymentLinkRecord,
  type ProviderChargeRecord,
} from '../../../../src/modules/risk-assessment/domain/model/PaymentLinkReconciliation.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { ANCHOR, activity, hoursBefore } from '../../../helpers/risk-assessment/paymentActivityFixtures.js';

const QUIET_LINKS = { total: 0, paid: 0, refused: 0, expired: 0, refunded: 0, paidAmount: 0, refundedAmount: 0 };
const QUIET_ACTIVITY = {
  attempts90d: 0,
  succeeded90d: 0,
  failed90d: 0,
  suspiciousDeclines90d: 0,
  chargebacks90d: 0,
  fraudWarnings90d: 0,
  distinctCustomers90d: 0,
};

function input(overrides: Partial<MerchantRiskInput> = {}): MerchantRiskInput {
  return {
    links: QUIET_LINKS,
    activity: QUIET_ACTIVITY,
    cases: { openCases: 0, fraudConfirmedCases: 0 },
    merchantSince: fromDate(new Date('2025-01-01T00:00:00Z')),
    now: ANCHOR,
    ...overrides,
  };
}

describe('assessMerchantRisk', () => {
  it('is LOW with no factors for a quiet merchant', () => {
    expect(assessMerchantRisk(input())).toEqual({ score: 0, level: 'LOW', factors: [] });
  });

  it('uses the network chargeback ratio when there is volume, and plain chargebacks otherwise — never both', () => {
    const withVolume = assessMerchantRisk(input({ activity: { ...QUIET_ACTIVITY, attempts90d: 100, succeeded90d: 100, chargebacks90d: 2 } }));
    const withoutVolume = assessMerchantRisk(input({ activity: { ...QUIET_ACTIVITY, attempts90d: 5, succeeded90d: 5, chargebacks90d: 2 } }));

    expect(withVolume.factors.map((f) => f.code)).toEqual(['CHARGEBACK_RATIO']);
    expect(withVolume.factors[0]?.reason).toContain('2.0%');
    expect(withoutVolume.factors.map((f) => f.code)).toEqual(['CHARGEBACKS']);
  });

  it('ignores rates without a minimum sample', () => {
    const small = assessMerchantRisk(input({ links: { ...QUIET_LINKS, total: 4, refused: 3, paid: 2, refunded: 2 } }));
    const large = assessMerchantRisk(input({ links: { ...QUIET_LINKS, total: 20, refused: 8, paid: 12, refunded: 3 } }));

    expect(small.factors).toEqual([]);
    expect(large.factors.map((f) => f.code)).toEqual(['REFUSED_LINKS', 'REFUNDS']);
  });

  it('adds up, caps at 100 and flags a new merchant cashing in fast', () => {
    const result = assessMerchantRisk(
      input({
        merchantSince: fromDate(new Date(new Date(ANCHOR).getTime() - 5 * 86_400_000)),
        links: { ...QUIET_LINKS, total: 30, paid: 25, refused: 10, refunded: 5, paidAmount: 25_000 },
        activity: { ...QUIET_ACTIVITY, attempts90d: 60, succeeded90d: 30, failed90d: 30, suspiciousDeclines90d: 15, chargebacks90d: 3, fraudWarnings90d: 2 },
        cases: { openCases: 1, fraudConfirmedCases: 1 },
      }),
    );

    expect(result.score).toBe(100);
    expect(result.level).toBe('CRITICAL');
    expect(result.factors.map((f) => f.code)).toContain('NEW_HIGH_VOLUME');
    expect(result.factors.every((f) => f.reason.length > 0)).toBe(true);
  });

  it('maps scores to levels at 25 / 50 / 75', () => {
    expect([24, 25, 50, 75].map(levelOf)).toEqual(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
  });
});

describe('summarizeMerchantActivity', () => {
  it('counts only the 90-day window up to the anchor', () => {
    const rows = [
      activity({ merchantId: 'acct_1', occurredAt: hoursBefore(1), customerId: 'a' }),
      activity({ merchantId: 'acct_1', occurredAt: hoursBefore(2), customerId: 'b', outcome: 'FAILED', declineCategory: 'FRAUD_SUSPECTED' }),
      activity({ merchantId: 'acct_1', occurredAt: hoursBefore(3), kind: 'CHARGEBACK', outcome: null, customerId: 'a' }),
      activity({ merchantId: 'acct_1', occurredAt: hoursBefore(24 * 91) }),
      activity({ merchantId: 'acct_1', occurredAt: hoursBefore(-1) }),
    ].map((r) => r.toProps());

    expect(summarizeMerchantActivity(rows, ANCHOR)).toEqual({
      attempts90d: 2,
      succeeded90d: 1,
      failed90d: 1,
      suspiciousDeclines90d: 1,
      chargebacks90d: 1,
      fraudWarnings90d: 0,
      distinctCustomers90d: 2,
    });
  });
});

describe('reconcilePaymentLinks', () => {
  function link(overrides: Partial<PaymentLinkRecord>): PaymentLinkRecord {
    return {
      id: 1,
      merchantUserId: 10,
      amount: 100,
      shippingAmount: 0,
      state: 'PAID',
      isPaid: true,
      provider: 'stripe',
      providerPaymentId: 'pi_1',
      refundAmount: null,
      createdAt: '2026-03-01T00:00:00.000Z',
      ...overrides,
    };
  }

  function charge(overrides: Partial<ProviderChargeRecord>): ProviderChargeRecord {
    return { chargeId: 'ch_x', paymentIntentId: null, amountCents: 10_000, succeeded: true, disputed: false, ...overrides };
  }

  it('classifies every situation against the live Stripe charges and only lists what needs a look', () => {
    const charges = [
      charge({ chargeId: 'ch_1', paymentIntentId: 'pi_1', amountCents: 10_500 }),
      charge({ chargeId: 'ch_3', paymentIntentId: 'pi_3' }),
      charge({ chargeId: 'ch_4', paymentIntentId: 'pi_4', amountCents: 9_000 }),
      charge({ chargeId: 'ch_5', paymentIntentId: 'pi_5', disputed: true }),
      // A failed attempt on the same PaymentIntent does not count as charged.
      charge({ chargeId: 'ch_1b', paymentIntentId: 'pi_1', amountCents: 10_500, succeeded: false }),
    ];

    const report = reconcilePaymentLinks(
      [
        link({ id: 1, shippingAmount: 5 }), // 105 USD charged: matched
        link({ id: 2, providerPaymentId: 'pi_never' }), // paid, Stripe has no charge
        link({ id: 3, providerPaymentId: 'pi_3', state: 'ACTIVE', isPaid: false }), // Stripe charged, link unpaid
        link({ id: 4, providerPaymentId: 'pi_4' }), // 90 vs 100
        link({ id: 5, providerPaymentId: 'pi_5' }), // disputed
        link({ id: 6, providerPaymentId: null }), // paid without id
        link({ id: 7, providerPaymentId: 'cf_7', amount: 50, provider: 'coinflow', state: 'DISBURSED', isPaid: false }), // not a Stripe link
        link({ id: 8, providerPaymentId: null, state: 'EXPIRED', isPaid: false }), // nothing happened
        link({ id: 9, merchantUserId: 99, providerPaymentId: 'pi_9' }), // merchant whose Stripe account was not read
      ],
      charges,
      new Set([10]),
    );

    expect(report.totals).toEqual({
      MATCHED: 1,
      UNPAID: 1,
      PAID_WITHOUT_PROVIDER_PAYMENT: 1,
      PROVIDER_PAID_LINK_UNPAID: 1,
      AMOUNT_MISMATCH: 1,
      CHARGEBACK: 1,
      NO_PROVIDER_REFERENCE: 1,
      PROVIDER_NOT_QUERIED: 2,
    });
    expect(report.discrepancies.map((d) => [d.linkId, d.status])).toEqual([
      [2, 'PAID_WITHOUT_PROVIDER_PAYMENT'],
      [3, 'PROVIDER_PAID_LINK_UNPAID'],
      [4, 'AMOUNT_MISMATCH'],
      [5, 'CHARGEBACK'],
      [6, 'NO_PROVIDER_REFERENCE'],
      [7, 'PROVIDER_NOT_QUERIED'],
      [9, 'PROVIDER_NOT_QUERIED'],
    ]);
    expect(report.discrepancies.find((d) => d.linkId === 4)).toMatchObject({ expectedAmountCents: 10_000, providerAmountCents: 9_000 });
    expect(report.linksChecked).toBe(9);
  });
});
