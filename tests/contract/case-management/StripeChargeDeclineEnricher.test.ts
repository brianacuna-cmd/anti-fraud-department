import {
  withChargeDeclines,
  withChargeDetailDecline,
} from '../../../src/modules/case-management/infrastructure/adapters/inbound/http/mappers/StripeChargeDeclineEnricher.js';

const FAILED = {
  id: 'ch_failed',
  status: 'failed',
  failureCode: 'card_declined',
  networkDeclineCode: null,
  risk: { reason: 'insufficient_funds', type: 'issuer_declined' },
  cardCountry: 'CO',
  billingCountry: 'CO',
};

const PAID_IN_REVIEW = {
  id: 'ch_paid',
  status: 'succeeded',
  failureCode: null,
  risk: { reason: 'elevated_risk_level', type: 'manual_review' },
};

describe('StripeChargeDeclineEnricher', () => {
  it('classifies failed charges of a page and leaves the rest of the payload intact', () => {
    const page = { items: [FAILED, PAID_IN_REVIEW], hasMore: true, nextCursor: 'ch_paid' };

    const enriched = withChargeDeclines(page);

    expect(enriched).toMatchObject({ hasMore: true, nextCursor: 'ch_paid' });
    const items = enriched?.items as Record<string, unknown>[];
    expect(items[0]).toMatchObject({ cardCountry: 'CO', decline: { code: 'insufficient_funds', category: 'INSUFFICIENT_FUNDS' } });
    expect(items[1]?.decline).toBeNull();
  });

  it('enriches the single-charge detail', () => {
    const enriched = withChargeDetailDecline({ charge: FAILED, paymentMethod: null });

    expect(enriched?.charge).toMatchObject({ decline: { category: 'INSUFFICIENT_FUNDS' } });
    expect(enriched).toHaveProperty('paymentMethod', null);
  });

  it('passes error payloads and nulls through', () => {
    expect(withChargeDeclines(null)).toBeNull();
    expect(withChargeDeclines({ error: 'access revoked' })).toEqual({ error: 'access revoked' });
    expect(withChargeDetailDecline({ error: 'boom' })).toEqual({ error: 'boom' });
  });
});
