import { fromDate } from '../../../../src/shared/time/Instant.js';
import {
  toCanonicalRiskEvent,
  toRiskScoreResponse,
} from '../../../../src/modules/risk-assessment/infrastructure/adapters/inbound/http/mappers/RiskScoreHttpMapper.js';
import { createRiskScoringRuleId } from '../../../../src/modules/risk-assessment/domain/model/value-objects/RiskScoringRuleId.js';
import { createRiskScore } from '../../../../src/modules/risk-assessment/domain/model/value-objects/RiskScore.js';
import { oid } from '../../../support/oid.js';

const CREATED_AT = '2026-01-01T00:00:00.000Z';

describe('toCanonicalRiskEvent', () => {
  it('maps camelCase HTTP body to CanonicalRiskEvent and brands createdAt as Instant', () => {
    const event = toCanonicalRiskEvent({
      provider: 'stripe',
      providerEventType: 'CHARGEBACK',
      caseCustomerId: 'cust-1',
      amountCents: 2500,
      currency: 'USD',
      riskSignals: { providerRiskScore: 80 },
      createdAt: CREATED_AT,
      rawPayload: { secret: 'keep-for-domain-only' },
    });

    expect(event).toMatchObject({
      provider: 'stripe',
      providerEventType: 'CHARGEBACK',
      caseCustomerId: 'cust-1',
      amountCents: 2500,
      currency: 'USD',
      riskSignals: { providerRiskScore: 80 },
      createdAt: fromDate(new Date(CREATED_AT)),
      rawPayload: { secret: 'keep-for-domain-only' },
    });
  });

  it('maps subjectIdentity through when present', () => {
    const event = toCanonicalRiskEvent({
      provider: 'stripe',
      providerEventType: 'CHARGEBACK',
      caseCustomerId: 'cust-1',
      amountCents: 2500,
      currency: 'USD',
      riskSignals: {},
      createdAt: CREATED_AT,
      subjectIdentity: { nombre: 'John Smith', documento: '123456' },
    });

    expect(event.subjectIdentity).toEqual({ nombre: 'John Smith', documento: '123456' });
  });

  it('leaves subjectIdentity undefined when absent', () => {
    const event = toCanonicalRiskEvent({
      provider: 'stripe',
      providerEventType: 'CHARGEBACK',
      caseCustomerId: 'cust-1',
      amountCents: 2500,
      currency: 'USD',
      riskSignals: {},
      createdAt: CREATED_AT,
    });

    expect(event.subjectIdentity).toBeUndefined();
  });

  it('rejects snake_case keys so they are not accepted as CanonicalRiskEvent', () => {
    expect(() =>
      toCanonicalRiskEvent({
        provider: 'stripe',
        providerEventType: 'CHARGEBACK',
        caseCustomerId: 'cust-1',
        amount_cents: 2500,
        currency: 'USD',
        riskSignals: {},
        createdAt: CREATED_AT,
      } as never),
    ).toThrow(/camelCase/);
  });
});

describe('toRiskScoreResponse', () => {
  it('returns score and provenance and never includes rawPayload', () => {
    const dto = toRiskScoreResponse({
      riskScore: createRiskScore(65),
      ruleId: createRiskScoringRuleId(oid('rule-1')),
      name: 'dispute-score',
      conditionsVersion: 2,
      hits: [{ points: 20 }],
    });

    expect(dto).toEqual({
      riskScore: 65,
      ruleId: oid('rule-1'),
      name: 'dispute-score',
      conditionsVersion: 2,
    });
    expect(dto).not.toHaveProperty('rawPayload');
  });
});
