import { mapCoinflowEnvelope } from '../../../../src/modules/ingest/infrastructure/adapters/outbound/mapping/CoinflowMapper.js';

const CREATED = '2026-01-15T12:00:00.000Z';

function coinflowEvent(eventType: string, data: Record<string, unknown>) {
  return {
    eventType,
    category: 'Payment',
    created: CREATED,
    data,
  };
}

const PAYMENT = {
  id: 'pay_1',
  customerId: 'cust_cf',
  subtotal: { cents: 1999, currency: 'USD' },
};

describe('mapCoinflowEnvelope', () => {
  it('maps Card Payment Suspected Fraud using subtotal.cents and composite providerEventId', () => {
    const envelope = coinflowEvent('Card Payment Suspected Fraud', PAYMENT);
    const result = mapCoinflowEnvelope(envelope);

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') {
      throw new Error('expected mapped');
    }
    expect(result.event.provider).toBe('coinflow');
    expect(result.event.providerEventType).toBe('Card Payment Suspected Fraud');
    expect(result.event.amountCents).toBe(1999);
    expect(result.event.caseCustomerId).toBe('cust_cf');
    expect(result.event.currency).toBe('USD');
    expect(result.event.providerEventId).toBe(`Card Payment Suspected Fraud:pay_1:${CREATED}`);
    expect(result.event.riskSignals.eventType).toBe('Card Payment Suspected Fraud');
    expect(result.event).not.toHaveProperty('riskScore');
    expect(result.event.rawPayload).toEqual(envelope);
  });

  it('accepts Payment Pending Review, Card Payment Declined, and Card Payment Authorized', () => {
    const types = [
      'Payment Pending Review',
      'Card Payment Declined',
      'Card Payment Authorized',
    ] as const;

    for (const eventType of types) {
      const result = mapCoinflowEnvelope(
        coinflowEvent(eventType, {
          ...PAYMENT,
          id: `pay_${eventType}`,
          subtotal: { cents: 4200, currency: 'usd' },
          declineCode: eventType === 'Card Payment Declined' ? 'suspected_fraud' : undefined,
        }),
      );

      expect(result.status).toBe('mapped');
      if (result.status !== 'mapped') {
        throw new Error(`expected mapped for ${eventType}`);
      }
      expect(result.event.providerEventType).toBe(eventType);
      expect(result.event.amountCents).toBe(4200);
      expect(result.event.providerEventId).toBe(`${eventType}:pay_${eventType}:${CREATED}`);
    }
  });

  it('builds a different composite providerEventId from eventType, data.id, and created', () => {
    const created = '2026-08-14T00:00:00.000Z';
    const result = mapCoinflowEnvelope({
      eventType: 'Card Payment Authorized',
      created,
      data: { id: 'abc', customerId: 'c1', subtotal: { cents: 1, currency: 'USD' } },
    });

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') {
      throw new Error('expected mapped');
    }
    expect(result.event.providerEventId).toBe('Card Payment Authorized:abc:2026-08-14T00:00:00.000Z');
    expect(result.event.amountCents).toBe(1);
  });

  it('ignores an unknown Coinflow eventType', () => {
    const result = mapCoinflowEnvelope({
      eventType: 'Settlement Completed',
      created: CREATED,
      data: PAYMENT,
    });

    expect(result.status).toBe('ignored');
    if (result.status !== 'ignored') {
      throw new Error('expected ignored');
    }
    expect(result.reason).toBe('unknown_event_type');
  });

  it('returns failed when customerId is missing', () => {
    const result = mapCoinflowEnvelope(
      coinflowEvent('Card Payment Authorized', { id: 'pay_x', subtotal: { cents: 10, currency: 'USD' } }),
    );

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') {
      throw new Error('expected failed');
    }
    expect(result.reason).toBe('missing_customer');
  });
});
