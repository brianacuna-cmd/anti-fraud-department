import { mapProviderEnvelope } from '../../../../src/modules/ingest/infrastructure/adapters/outbound/mapping/mapProviderEnvelope.js';

describe('mapProviderEnvelope', () => {
  it('classifies verified radar.review.opened as ignored', () => {
    const result = mapProviderEnvelope('stripe', {
      id: 'evt_review',
      type: 'radar.review.opened',
      created: 1_704_067_200,
      data: { object: {} },
    });

    expect(result.status).toBe('ignored');
    if (result.status !== 'ignored') {
      throw new Error('expected ignored');
    }
    expect(result.reason).toBe('unknown_event_type');
  });

  it('classifies a Stripe charge without customer as failed', () => {
    const result = mapProviderEnvelope('stripe', {
      id: 'evt_1',
      type: 'charge.succeeded',
      created: 1_704_067_200,
      data: {
        object: {
          amount: 100,
          currency: 'usd',
          outcome: { risk_score: 1, risk_level: 'normal' },
        },
      },
    });

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') {
      throw new Error('expected failed');
    }
    expect(result.reason).toBe('missing_customer');
  });

  it('classifies an unparsable Bridge amount as failed', () => {
    const result = mapProviderEnvelope('bridge', {
      event_id: 'wh_bad',
      event_type: 'transfer.updated',
      event_created_at: '2026-01-01T00:00:00.000Z',
      event_object: { amount: 'abc', currency: 'usd', customer_id: 'c1' },
    });

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') {
      throw new Error('expected failed');
    }
    expect(result.reason).toBe('unparsable_amount');
  });

  it('routes a Coinflow MVP type to a mapped event', () => {
    const result = mapProviderEnvelope('coinflow', {
      eventType: 'Card Payment Declined',
      created: '2026-01-01T00:00:00.000Z',
      data: { id: 'd1', customerId: 'c1', subtotal: { cents: 50, currency: 'USD' } },
    });

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') {
      throw new Error('expected mapped');
    }
    expect(result.event.provider).toBe('coinflow');
    expect(result.event.amountCents).toBe(50);
  });
});
