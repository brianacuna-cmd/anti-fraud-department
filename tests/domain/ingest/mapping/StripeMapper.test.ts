import { mapStripeEnvelope } from '../../../../src/modules/ingest/infrastructure/adapters/outbound/mapping/StripeMapper.js';

const CREATED = 1_704_067_200;

function chargeEvent(type: string, charge: Record<string, unknown>) {
  return {
    id: `evt_${type.replace('.', '_')}`,
    object: 'event',
    type,
    created: CREATED,
    data: { object: charge },
  };
}

const CHARGE = {
  id: 'ch_1',
  object: 'charge',
  amount: 2500,
  currency: 'usd',
  customer: 'cus_1',
  outcome: { risk_score: 68, risk_level: 'elevated' },
};

describe('mapStripeEnvelope', () => {
  it('maps charge.succeeded amountCents as-is and copies Radar fields only into riskSignals', () => {
    const result = mapStripeEnvelope(chargeEvent('charge.succeeded', CHARGE));

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') {
      throw new Error('expected mapped');
    }
    expect(result.event.provider).toBe('stripe');
    expect(result.event.providerEventType).toBe('charge.succeeded');
    expect(result.event.providerEventId).toBe('evt_charge_succeeded');
    expect(result.event.eventId).toBe('evt_charge_succeeded');
    expect(result.event.caseCustomerId).toBe('cus_1');
    expect(result.event.amountCents).toBe(2500);
    expect(result.event.currency).toBe('USD');
    expect(result.event.riskSignals.stripeRiskScore).toBe(68);
    expect(result.event.riskSignals.stripeRiskLevel).toBe('elevated');
    expect(result.event).not.toHaveProperty('riskScore');
    expect(result.event.rawPayload).toEqual(chargeEvent('charge.succeeded', CHARGE));
  });

  it('maps charge.failed with a different amount and never sets department riskScore', () => {
    const failed = { ...CHARGE, amount: 9900, outcome: { risk_score: 12, risk_level: 'normal' } };
    const result = mapStripeEnvelope(chargeEvent('charge.failed', failed));

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') {
      throw new Error('expected mapped');
    }
    expect(result.event.providerEventType).toBe('charge.failed');
    expect(result.event.amountCents).toBe(9900);
    expect(result.event.riskSignals.stripeRiskScore).toBe(12);
    expect(result.event).not.toHaveProperty('riskScore');
  });

  it('classifies a failed charge by its most specific code and exposes both countries', () => {
    const failed = {
      ...CHARGE,
      status: 'failed',
      failure_code: 'card_declined',
      outcome: { type: 'issuer_declined', reason: 'stolen_card', risk_score: 40, risk_level: 'normal' },
      payment_method_details: { card: { country: 'ng' } },
      billing_details: { address: { country: 'US' } },
    };

    const result = mapStripeEnvelope(chargeEvent('charge.failed', failed));

    if (result.status !== 'mapped') {
      throw new Error('expected mapped');
    }
    expect(result.event.riskSignals).toMatchObject({
      declineCode: 'stolen_card',
      declineCategory: 'FRAUD_SUSPECTED',
      cardCountry: 'NG',
      billingCountry: 'US',
    });
  });

  it('does not classify a paid charge that Radar only sent to review', () => {
    const reviewed = {
      ...CHARGE,
      status: 'succeeded',
      outcome: { type: 'manual_review', reason: 'elevated_risk_level', risk_score: 70, risk_level: 'elevated' },
    };

    const result = mapStripeEnvelope(chargeEvent('charge.succeeded', reviewed));

    if (result.status !== 'mapped') {
      throw new Error('expected mapped');
    }
    expect(result.event.riskSignals).not.toHaveProperty('declineCode');
    expect(result.event.riskSignals).not.toHaveProperty('declineCategory');
  });

  it('maps charge.updated when outcome is present', () => {
    const updated = { ...CHARGE, amount: 4100, outcome: { risk_score: 75, risk_level: 'highest' } };
    const result = mapStripeEnvelope(chargeEvent('charge.updated', updated));

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') {
      throw new Error('expected mapped');
    }
    expect(result.event.providerEventType).toBe('charge.updated');
    expect(result.event.amountCents).toBe(4100);
    expect(result.event.riskSignals.stripeRiskLevel).toBe('highest');
    expect(result.event).not.toHaveProperty('riskScore');
  });

  it('ignores charge.updated when outcome is missing', () => {
    const { outcome: _outcome, ...withoutOutcome } = CHARGE;
    const result = mapStripeEnvelope(chargeEvent('charge.updated', withoutOutcome));

    expect(result.status).toBe('ignored');
    if (result.status !== 'ignored') {
      throw new Error('expected ignored');
    }
    expect(result.reason).toBe('unknown_event_type');
  });

  it('accepts radar.early_fraud_warning.created and puts categorical fields in riskSignals only', () => {
    const envelope = {
      id: 'evt_efw_1',
      object: 'event',
      type: 'radar.early_fraud_warning.created',
      created: CREATED,
      data: {
        object: {
          id: 'issfr_1',
          object: 'radar.early_fraud_warning',
          fraud_type: 'unauthorized_use_of_card',
          actionable: true,
          payment_intent: 'pi_1',
          charge: {
            id: 'ch_efw',
            amount: 5000,
            currency: 'usd',
            customer: 'cus_efw',
          },
        },
      },
    };

    const result = mapStripeEnvelope(envelope);

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') {
      throw new Error('expected mapped');
    }
    expect(result.event.providerEventType).toBe('radar.early_fraud_warning.created');
    expect(result.event.providerEventId).toBe('evt_efw_1');
    expect(result.event.caseCustomerId).toBe('cus_efw');
    expect(result.event.amountCents).toBe(5000);
    expect(result.event.riskSignals.fraudType).toBe('unauthorized_use_of_card');
    expect(result.event.riskSignals.actionable).toBe(true);
    expect(result.event).not.toHaveProperty('riskScore');
    expect(result.event.riskSignals).not.toHaveProperty('riskScore');
  });

  it('ignores unknown types such as radar.review.opened', () => {
    const result = mapStripeEnvelope({
      id: 'evt_review',
      type: 'radar.review.opened',
      created: CREATED,
      data: { object: { id: 'prv_1' } },
    });

    expect(result.status).toBe('ignored');
    if (result.status !== 'ignored') {
      throw new Error('expected ignored');
    }
    expect(result.reason).toBe('unknown_event_type');
  });

  it('populates subjectIdentity from billing_details.name and metadata.documento when present', () => {
    const withIdentity = {
      ...CHARGE,
      billing_details: { name: 'Ana Perez' },
      metadata: { documento: '12345678' },
    };
    const result = mapStripeEnvelope(chargeEvent('charge.succeeded', withIdentity));

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') {
      throw new Error('expected mapped');
    }
    expect(result.event.subjectIdentity).toEqual({
      name: 'Ana Perez',
      document: '12345678',
      entryType: 'PERSON',
    });
  });

  it('leaves subjectIdentity undefined when the charge has no billing/metadata identity fields', () => {
    const result = mapStripeEnvelope(chargeEvent('charge.succeeded', CHARGE));

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') {
      throw new Error('expected mapped');
    }
    expect(result.event.subjectIdentity).toBeUndefined();
  });

  it('returns failed when a charge has no customer', () => {
    const { customer: _customer, ...withoutCustomer } = CHARGE;
    const result = mapStripeEnvelope(chargeEvent('charge.succeeded', withoutCustomer));

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') {
      throw new Error('expected failed');
    }
    expect(result.reason).toBe('missing_customer');
  });

  it('maps a different EFW fraud_type without treating it as department riskScore', () => {
    const envelope = {
      id: 'evt_efw_2',
      type: 'radar.early_fraud_warning.created',
      created: CREATED,
      data: {
        object: {
          fraud_type: 'made_with_stolen_card',
          charge: { amount: 1200, currency: 'eur', customer: 'cus_2' },
        },
      },
    };

    const result = mapStripeEnvelope(envelope);

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') {
      throw new Error('expected mapped');
    }
    expect(result.event.amountCents).toBe(1200);
    expect(result.event.currency).toBe('EUR');
    expect(result.event.riskSignals.fraudType).toBe('made_with_stolen_card');
    expect(result.event).not.toHaveProperty('riskScore');
  });
});

describe('mapStripeEnvelope payment activity', () => {
  const DISPUTE = {
    id: 'evt_dispute',
    type: 'charge.dispute.created',
    created: CREATED,
    data: { object: { id: 'dp_1', charge: 'ch_disputed', amount: 2500, currency: 'usd', reason: 'fraudulent', status: 'needs_response' } },
  };

  it('counts succeeded and failed charges as attempts referencing the charge, and charge.updated as nothing', () => {
    const ok = mapStripeEnvelope(chargeEvent('charge.succeeded', CHARGE));
    const ko = mapStripeEnvelope(chargeEvent('charge.failed', { ...CHARGE, status: 'failed' }));
    const updated = mapStripeEnvelope(chargeEvent('charge.updated', CHARGE));

    if (ok.status !== 'mapped' || ko.status !== 'mapped' || updated.status !== 'mapped') throw new Error('expected mapped');
    expect(ok.event.paymentActivity).toEqual({ kind: 'ATTEMPT', outcome: 'SUCCEEDED', providerReference: 'ch_1' });
    expect(ko.event.paymentActivity).toEqual({ kind: 'ATTEMPT', outcome: 'FAILED', providerReference: 'ch_1' });
    expect(updated.event.paymentActivity).toBeUndefined();
  });

  it('reports a dispute without customer as missing_customer carrying the disputed charge', () => {
    expect(mapStripeEnvelope(DISPUTE)).toEqual({
      status: 'failed',
      reason: 'missing_customer',
      providerReference: 'ch_disputed',
    });
  });

  it('maps the dispute as a chargeback once the charge owner is known', () => {
    const result = mapStripeEnvelope(DISPUTE, { customerId: 'cus_owner' });

    if (result.status !== 'mapped') throw new Error('expected mapped');
    expect(result.event.caseCustomerId).toBe('cus_owner');
    expect(result.event.amountCents).toBe(2500);
    expect(result.event.riskSignals).toMatchObject({ disputeReason: 'fraudulent', disputeStatus: 'needs_response' });
    expect(result.event.paymentActivity).toEqual({ kind: 'CHARGEBACK', providerReference: 'ch_disputed' });
  });

  it('never uses the hint over a customer the payload does carry', () => {
    const result = mapStripeEnvelope(chargeEvent('charge.succeeded', CHARGE), { customerId: 'cus_wrong' });

    if (result.status !== 'mapped') throw new Error('expected mapped');
    expect(result.event.caseCustomerId).toBe('cus_1');
  });
});

describe('mapStripeEnvelope merchant and related references', () => {
  it('records the connected account as merchant and the PaymentIntent as related reference', () => {
    const envelope = { ...chargeEvent('charge.succeeded', { ...CHARGE, payment_intent: 'pi_9' }), account: 'acct_merchant' };

    const result = mapStripeEnvelope(envelope);

    if (result.status !== 'mapped') throw new Error('expected mapped');
    expect(result.event.paymentActivity).toEqual({
      kind: 'ATTEMPT',
      outcome: 'SUCCEEDED',
      providerReference: 'ch_1',
      relatedReferences: ['pi_9'],
      merchantId: 'acct_merchant',
    });
  });
});
