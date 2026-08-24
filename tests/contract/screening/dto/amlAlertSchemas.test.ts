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

  it('accepts estado, severidad, watchlist_id, from, and to together', () => {
    const result = listAmlAlertsQuerySchema.safeParse({
      estado: 'OPEN',
      severidad: 'HIGH',
      watchlist_id: '507f1f77bcf86cd799439011',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-31T00:00:00.000Z',
    });

    expect(result.success).toBe(true);
  });

  it('rejects an unknown severidad value', () => {
    const result = listAmlAlertsQuerySchema.safeParse({ severidad: 'BOGUS' });

    expect(result.success).toBe(false);
  });

  it('rejects an unknown estado value', () => {
    const result = listAmlAlertsQuerySchema.safeParse({ estado: 'BOGUS' });

    expect(result.success).toBe(false);
  });
});

describe('resolveAmlAlertSchema', () => {
  it('accepts CONFIRMED_MATCH with a non-empty justificacion', () => {
    const result = resolveAmlAlertSchema.safeParse({
      dictamen: 'CONFIRMED_MATCH',
      justificacion: 'Matched government ID.',
    });

    expect(result.success).toBe(true);
  });

  it('accepts FALSE_POSITIVE with a non-empty justificacion', () => {
    const result = resolveAmlAlertSchema.safeParse({
      dictamen: 'FALSE_POSITIVE',
      justificacion: 'Different date of birth.',
    });

    expect(result.success).toBe(true);
  });

  it('accepts a justificacion that is a single non-whitespace character after trim', () => {
    const result = resolveAmlAlertSchema.safeParse({
      dictamen: 'FALSE_POSITIVE',
      justificacion: '  x  ',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.justificacion).toBe('x');
    }
  });

  it('rejects an unknown dictamen value', () => {
    const result = resolveAmlAlertSchema.safeParse({
      dictamen: 'BOGUS',
      justificacion: 'valid text',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a missing justificacion', () => {
    const result = resolveAmlAlertSchema.safeParse({
      dictamen: 'CONFIRMED_MATCH',
    });

    expect(result.success).toBe(false);
  });

  it('rejects an empty justificacion', () => {
    const result = resolveAmlAlertSchema.safeParse({
      dictamen: 'CONFIRMED_MATCH',
      justificacion: '',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a whitespace-only justificacion', () => {
    const result = resolveAmlAlertSchema.safeParse({
      dictamen: 'CONFIRMED_MATCH',
      justificacion: '   ',
    });

    expect(result.success).toBe(false);
  });
});
