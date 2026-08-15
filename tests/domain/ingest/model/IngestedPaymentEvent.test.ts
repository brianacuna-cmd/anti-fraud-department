import { createIngestedPaymentEvent } from '../../../../src/modules/ingest/domain/model/IngestedPaymentEvent.js';
import { IngestError } from '../../../../src/modules/ingest/domain/errors/IngestError.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

const VALID = {
  provider: 'stripe',
  providerEventType: 'charge.succeeded',
  caseCustomerId: 'cust-1',
  amountCents: 2500,
  currency: 'USD',
  riskSignals: { stripeRiskScore: 68, stripeRiskLevel: 'elevated' },
  createdAt: NOW,
};

describe('createIngestedPaymentEvent', () => {
  it('accepts a camelCase event and preserves optional fields', () => {
    const event = createIngestedPaymentEvent({
      ...VALID,
      eventId: 'evt-1',
      providerEventId: 'pevt-1',
      rail: 'card',
      rawPayload: { secret: true },
    });

    expect(event.provider).toBe('stripe');
    expect(event.providerEventType).toBe('charge.succeeded');
    expect(event.caseCustomerId).toBe('cust-1');
    expect(event.amountCents).toBe(2500);
    expect(event.currency).toBe('USD');
    expect(event.riskSignals).toEqual({ stripeRiskScore: 68, stripeRiskLevel: 'elevated' });
    expect(event.createdAt).toBe(NOW);
    expect(event.eventId).toBe('evt-1');
    expect(event.providerEventId).toBe('pevt-1');
    expect(event.rail).toBe('card');
    expect(event.rawPayload).toEqual({ secret: true });
  });

  it('rejects snake_case amount_cents keys', () => {
    const input = {
      provider: 'stripe',
      providerEventType: 'charge.succeeded',
      caseCustomerId: 'cust-1',
      amount_cents: 2500,
      currency: 'USD',
      riskSignals: {},
      createdAt: NOW,
    };

    expect(() => createIngestedPaymentEvent(input)).toThrow(IngestError);
    try {
      createIngestedPaymentEvent(input);
    } catch (error) {
      expect((error as IngestError).code).toBe('INVARIANT_VIOLATION');
    }
  });

  it('rejects snake_case provider_event_type keys', () => {
    const input = {
      provider: 'stripe',
      provider_event_type: 'charge.succeeded',
      caseCustomerId: 'cust-1',
      amountCents: 2500,
      currency: 'USD',
      riskSignals: {},
      createdAt: NOW,
    };

    expect(() => createIngestedPaymentEvent(input)).toThrow(IngestError);
  });

  it('rejects a missing required camelCase field', () => {
    const withoutAmount = {
      provider: VALID.provider,
      providerEventType: VALID.providerEventType,
      caseCustomerId: VALID.caseCustomerId,
      currency: VALID.currency,
      riskSignals: VALID.riskSignals,
      createdAt: VALID.createdAt,
    };

    expect(() => createIngestedPaymentEvent(withoutAmount)).toThrow(IngestError);
  });

  it('does not copy Stripe risk score onto a department riskScore field', () => {
    const event = createIngestedPaymentEvent(VALID);

    expect(event).not.toHaveProperty('riskScore');
    expect(event.riskSignals.stripeRiskScore).toBe(68);
  });
});
