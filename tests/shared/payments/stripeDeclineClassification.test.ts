import { classifyStripeDecline } from '../../../src/shared/payments/stripeDeclineClassification.js';

describe('classifyStripeDecline', () => {
  it('returns null when the charge carries no code (it did not fail)', () => {
    expect(classifyStripeDecline([null, undefined, '  '])).toBeNull();
  });

  it('lets the specific decline code win over the generic card_declined', () => {
    expect(classifyStripeDecline(['insufficient_funds', 'card_declined'])).toEqual({
      code: 'insufficient_funds',
      category: 'INSUFFICIENT_FUNDS',
    });
  });

  it.each([
    ['stolen_card', 'FRAUD_SUSPECTED'],
    ['highest_risk_level', 'FRAUD_SUSPECTED'],
    ['incorrect_cvc', 'AUTHENTICATION_FAILED'],
    ['expired_card', 'INVALID_CARD'],
    ['do_not_honor', 'ISSUER_DECLINED'],
    ['processing_error', 'TECHNICAL_ERROR'],
  ])('classifies %s as %s', (code, category) => {
    expect(classifyStripeDecline([code])?.category).toBe(category);
  });

  it('is case-insensitive and trims', () => {
    expect(classifyStripeDecline([' Fraudulent '])).toEqual({ code: 'Fraudulent', category: 'FRAUD_SUSPECTED' });
  });

  it('skips unknown codes to find a known one, and falls back to UNKNOWN with the first code', () => {
    expect(classifyStripeDecline(['brand_new_code', 'expired_card'])?.category).toBe('INVALID_CARD');
    expect(classifyStripeDecline(['brand_new_code', 'constructor'])).toEqual({
      code: 'brand_new_code',
      category: 'UNKNOWN',
    });
  });
});
