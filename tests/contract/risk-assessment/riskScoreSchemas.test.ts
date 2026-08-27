import { calculateRiskScoreSchema } from '../../../src/modules/risk-assessment/infrastructure/adapters/inbound/http/dto/riskScoreSchemas.js';

const BASE_BODY = {
  provider: 'stripe',
  providerEventType: 'CHARGEBACK',
  caseCustomerId: 'cust-1',
  amountCents: 2500,
  currency: 'USD',
  riskSignals: {},
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('calculateRiskScoreSchema subjectIdentity', () => {
  it('accepts a body without subjectIdentity (backward compatible)', () => {
    const result = calculateRiskScoreSchema.safeParse(BASE_BODY);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.subjectIdentity).toBeUndefined();
    }
  });

  it('accepts a body with a valid optional subjectIdentity', () => {
    const result = calculateRiskScoreSchema.safeParse({
      ...BASE_BODY,
      subjectIdentity: {
        name: 'John Smith',
        document: '123456',
        walletAddress: '0xabc',
        entryType: 'PERSON',
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.subjectIdentity).toEqual({
        name: 'John Smith',
        document: '123456',
        walletAddress: '0xabc',
        entryType: 'PERSON',
      });
    }
  });

  it('accepts a subjectIdentity with only some fields present', () => {
    const result = calculateRiskScoreSchema.safeParse({
      ...BASE_BODY,
      subjectIdentity: { name: 'John Smith' },
    });

    expect(result.success).toBe(true);
  });

  it('still rejects unknown top-level keys (.strict())', () => {
    const result = calculateRiskScoreSchema.safeParse({
      ...BASE_BODY,
      amount_cents: 2500,
    });

    expect(result.success).toBe(false);
  });

  it('rejects an unknown key nested inside subjectIdentity (.strict())', () => {
    const result = calculateRiskScoreSchema.safeParse({
      ...BASE_BODY,
      subjectIdentity: { name: 'John Smith', extra: 'nope' },
    });

    expect(result.success).toBe(false);
  });
});
