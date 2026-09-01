import {
  listAmlAlertsQuerySchema,
  resolveAmlAlertSchema,
} from '../../../../src/modules/screening/infrastructure/adapters/inbound/http/dto/amlAlertSchemas.js';

describe('listAmlAlertsQuerySchema', () => {
  it('accepts an empty query (all filters optional)', () => {
    const result = listAmlAlertsQuerySchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.offset).toBe(0);
    }
  });

  it('accepts status, severity, watchlist_id, from, and to together', () => {
    const result = listAmlAlertsQuerySchema.safeParse({
      status: 'OPEN',
      severity: 'HIGH',
      watchlist_id: '507f1f77bcf86cd799439011',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-31T00:00:00.000Z',
    });

    expect(result.success).toBe(true);
  });

  it('accepts optional customerId and rejects an empty string', () => {
    const accepted = listAmlAlertsQuerySchema.safeParse({ customerId: 'cus_9aFbZ' });
    expect(accepted.success).toBe(true);
    if (accepted.success) {
      expect(accepted.data.customerId).toBe('cus_9aFbZ');
    }

    const rejected = listAmlAlertsQuerySchema.safeParse({ customerId: '' });
    expect(rejected.success).toBe(false);
  });

  it('rejects an unknown severity value', () => {
    const result = listAmlAlertsQuerySchema.safeParse({ severity: 'BOGUS' });

    expect(result.success).toBe(false);
  });

  it('rejects an unknown status value', () => {
    const result = listAmlAlertsQuerySchema.safeParse({ status: 'BOGUS' });

    expect(result.success).toBe(false);
  });
});

describe('resolveAmlAlertSchema', () => {
  it('accepts CONFIRMED_MATCH with a non-empty justification', () => {
    const result = resolveAmlAlertSchema.safeParse({
      verdict: 'CONFIRMED_MATCH',
      justification: 'Matched government ID.',
    });

    expect(result.success).toBe(true);
  });

  it('accepts FALSE_POSITIVE with a non-empty justification', () => {
    const result = resolveAmlAlertSchema.safeParse({
      verdict: 'FALSE_POSITIVE',
      justification: 'Different date of birth.',
    });

    expect(result.success).toBe(true);
  });

  it('accepts a justification that is a single non-whitespace character after trim', () => {
    const result = resolveAmlAlertSchema.safeParse({
      verdict: 'FALSE_POSITIVE',
      justification: '  x  ',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.justification).toBe('x');
    }
  });

  it('rejects an unknown verdict value', () => {
    const result = resolveAmlAlertSchema.safeParse({
      verdict: 'BOGUS',
      justification: 'valid text',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a missing justification', () => {
    const result = resolveAmlAlertSchema.safeParse({
      verdict: 'CONFIRMED_MATCH',
    });

    expect(result.success).toBe(false);
  });

  it('rejects an empty justification', () => {
    const result = resolveAmlAlertSchema.safeParse({
      verdict: 'CONFIRMED_MATCH',
      justification: '',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a whitespace-only justification', () => {
    const result = resolveAmlAlertSchema.safeParse({
      verdict: 'CONFIRMED_MATCH',
      justification: '   ',
    });

    expect(result.success).toBe(false);
  });
});
