import { resolveAmlAlertSchema } from '../../../../src/modules/screening/infrastructure/adapters/inbound/http/dto/amlAlertSchemas.js';

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
