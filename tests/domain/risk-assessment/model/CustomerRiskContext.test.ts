import {
  summarizePaymentActivity,
  summarizePaymentContext,
  toActivityVariables,
  toCustomerHistoryVariables,
  ACTIVITY_VARIABLES,
  CUSTOMER_HISTORY_VARIABLES,
} from '../../../../src/modules/risk-assessment/domain/model/CustomerRiskContext.js';
import { createCanonicalRiskEvent } from '../../../../src/modules/risk-assessment/domain/model/CanonicalRiskEvent.js';
import { isScorableField } from '../../../../src/modules/risk-assessment/domain/services/factorScoringJdm.js';
import { ANCHOR, activity, contextScenario, hoursBefore, windowScenario } from '../../../helpers/risk-assessment/paymentActivityFixtures.js';

describe('summarizePaymentContext', () => {
  it('counts the event link (any customer, whole life) and the seller links failing 3+ times in 30 days', () => {
    const { rows, expected } = contextScenario();

    expect(
      summarizePaymentContext(rows.map((r) => r.toProps()), { paymentLinkReference: 'pi_link', merchantId: 'acct_seller', counterparty: '0xWallet', customerIds: ['cus_1'] }, ANCHOR),
    ).toEqual(expected);
  });

  it('is all zeros without a link or merchant', () => {
    const { rows } = contextScenario();

    expect(summarizePaymentContext(rows.map((r) => r.toProps()), { paymentLinkReference: null, merchantId: null }, ANCHOR)).toEqual({
      linkSuspiciousDeclines: 0,
      linkDistinctCards: 0,
      merchantLinksWithRepeatedFailures: 0,
      counterpartyPreviousTransfers: 0,
    });
  });
});

describe('summarizePaymentActivity', () => {
  it('counts each window on (anchor - window, anchor], per customer, ignoring the future', () => {
    const { rows, expected } = windowScenario();

    const summary = summarizePaymentActivity(
      rows.filter((r) => r.customerId === 'cus_1').map((r) => r.toProps()),
      ANCHOR,
    );

    expect(summary).toEqual(expected);
  });

  it('is all zeros for a customer with no history', () => {
    expect(summarizePaymentActivity([], ANCHOR)).toMatchObject({ attempts24h: 0, lifetimeAttempts: 0, firstActivityAt: null });
  });
});

describe('rule variables', () => {
  it('derives the failure rate and the days since the first activity', () => {
    const summary = summarizePaymentActivity(windowScenario().rows.filter((r) => r.customerId === 'cus_1').map((r) => r.toProps()), ANCHOR);

    expect(toActivityVariables(summary)).toMatchObject({ attempts24h: 4, failedAttempts24h: 3, failureRate24h: 75 });
    expect(
      toCustomerHistoryVariables(summary, { previousCases: 2, openCases: 1, fraudConfirmedCases: 1, falsePositiveCases: 0 }, ANCHOR),
    ).toEqual({
      previousCases: 2,
      openCases: 1,
      fraudConfirmedCases: 1,
      falsePositiveCases: 0,
      daysSinceFirstActivity: 200,
      lifetimeAttempts: 6,
      lifetimeChargebacks: 2,
    });
  });

  it('produces exactly the declared variables, so the editor and the engine agree', () => {
    const summary = summarizePaymentActivity([], ANCHOR);
    expect(Object.keys(toActivityVariables(summary)).sort()).toEqual([...ACTIVITY_VARIABLES].sort());
    expect(
      Object.keys(toCustomerHistoryVariables(summary, { previousCases: 0, openCases: 0, fraudConfirmedCases: 0, falsePositiveCases: 0 }, ANCHOR)).sort(),
    ).toEqual([...CUSTOMER_HISTORY_VARIABLES].sort());
  });

  it('lets rules score on every context variable, and only on declared ones', () => {
    for (const key of ACTIVITY_VARIABLES) expect(isScorableField(`activity.${key}`)).toBe(true);
    for (const key of CUSTOMER_HISTORY_VARIABLES) expect(isScorableField(`customerHistory.${key}`)).toBe(true);
    expect(isScorableField('activity.attempt24h')).toBe(false);
    expect(isScorableField('customerHistory.anything')).toBe(false);
  });
});

describe('CanonicalRiskEvent context namespaces', () => {
  const base = {
    provider: 'stripe',
    providerEventType: 'charge.failed',
    caseCustomerId: 'cus_1',
    amountCents: 100,
    currency: 'USD',
    riskSignals: {},
    createdAt: ANCHOR,
  };

  it('keeps known numeric variables', () => {
    const event = createCanonicalRiskEvent({ ...base, activity: { attempts24h: 12 }, customerHistory: { previousCases: 1 } });
    expect(event.activity).toEqual({ attempts24h: 12 });
    expect(event.customerHistory).toEqual({ previousCases: 1 });
  });

  it('rejects unknown keys and non-numbers', () => {
    expect(() => createCanonicalRiskEvent({ ...base, activity: { attempts48h: 1 } })).toThrow();
    expect(() => createCanonicalRiskEvent({ ...base, customerHistory: { previousCases: '3' } })).toThrow();
  });
});

describe('PaymentActivity', () => {
  it('requires an outcome on attempts and drops it on other kinds', () => {
    expect(() => activity({ outcome: null })).toThrow();
    expect(activity({ kind: 'CHARGEBACK', outcome: 'FAILED' }).outcome).toBeNull();
  });

  it('normalizes currency and countries to upper case', () => {
    const row = activity({ currency: 'eur', cardCountry: 'co', occurredAt: hoursBefore(1) }).toProps();
    expect(row.currency).toBe('EUR');
    expect(row.cardCountry).toBe('CO');
  });
});
