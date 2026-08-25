import { ALERT_TYPES, createAlertType } from '../../../../../src/modules/notifications/domain/model/value-objects/AlertType.js';

describe('createAlertType', () => {
  it.each(['CASE_ASSIGNED', 'SLA_DUE_SOON', 'APPROVAL_PENDING', 'CRITICAL_RISK'] as const)(
    'accepts %s',
    (value) => {
      expect(createAlertType(value)).toBe(value);
    },
  );

  it.each([
    ['CASO_ASIGNADO', 'CASE_ASSIGNED'],
    ['SLA_POR_VENCER', 'SLA_DUE_SOON'],
    ['APROBACION_PENDIENTE', 'APPROVAL_PENDING'],
    ['RIESGO_CRITICO', 'CRITICAL_RISK'],
  ] as const)('normalizes legacy %s to %s', (legacy, canonical) => {
    expect(createAlertType(legacy)).toBe(canonical);
  });

  it('rejects an unknown value as UNKNOWN_ALERT_TYPE', () => {
    expect.assertions(1);
    try {
      createAlertType('not_a_real_type');
    } catch (error) {
      expect((error as { code: string }).code).toBe('UNKNOWN_ALERT_TYPE');
    }
  });
});

describe('ALERT_TYPES catalog', () => {
  it('contains exactly the four product-confirmed alert types, no more no less', () => {
    expect(ALERT_TYPES).toEqual([
      'CASE_ASSIGNED',
      'SLA_DUE_SOON',
      'APPROVAL_PENDING',
      'CRITICAL_RISK',
    ]);
    expect(ALERT_TYPES).toHaveLength(4);
  });
});
