import { createCanonicalRiskEvent } from '../../../../src/modules/risk-assessment/domain/model/CanonicalRiskEvent.js';
import { RiskAssessmentError } from '../../../../src/modules/risk-assessment/domain/errors/RiskAssessmentError.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

const VALID = {
  provider: 'stripe',
  providerEventType: 'charge.dispute.created',
  caseCustomerId: 'cust-1',
  amountCents: 2500,
  currency: 'USD',
  riskSignals: { providerRiskScore: 80 },
  createdAt: NOW,
};

describe('createCanonicalRiskEvent', () => {
  it('accepts a camelCase event and preserves optional fields', () => {
    const event = createCanonicalRiskEvent({
      ...VALID,
      eventId: 'evt-1',
      providerEventId: 'pevt-1',
      rail: 'card',
      rawPayload: { secret: true },
    });

    expect(event.provider).toBe('stripe');
    expect(event.providerEventType).toBe('charge.dispute.created');
    expect(event.caseCustomerId).toBe('cust-1');
    expect(event.amountCents).toBe(2500);
    expect(event.currency).toBe('USD');
    expect(event.riskSignals).toEqual({ providerRiskScore: 80 });
    expect(event.createdAt).toBe(NOW);
    expect(event.eventId).toBe('evt-1');
    expect(event.providerEventId).toBe('pevt-1');
    expect(event.rail).toBe('card');
    expect(event.rawPayload).toEqual({ secret: true });
  });

  it('rejects snake_case amount_cents as scoring input', () => {
    const input = {
      provider: 'stripe',
      providerEventType: 'charge.dispute.created',
      caseCustomerId: 'cust-1',
      amount_cents: 2500,
      currency: 'USD',
      riskSignals: {},
      createdAt: NOW,
    };

    expect(() => createCanonicalRiskEvent(input)).toThrow(RiskAssessmentError);
    try {
      createCanonicalRiskEvent(input);
    } catch (error) {
      expect((error as RiskAssessmentError).code).toBe('INVARIANT_VIOLATION');
    }
  });

  it('rejects snake_case provider_event_type as scoring input', () => {
    const input = {
      provider: 'stripe',
      provider_event_type: 'charge.dispute.created',
      caseCustomerId: 'cust-1',
      amountCents: 2500,
      currency: 'USD',
      riskSignals: {},
      createdAt: NOW,
    };

    expect(() => createCanonicalRiskEvent(input)).toThrow(RiskAssessmentError);
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

    expect(() => createCanonicalRiskEvent(withoutAmount)).toThrow(RiskAssessmentError);
  });
});
