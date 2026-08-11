import { ALERT_TYPES, createAlertType } from '../../../../../src/modules/notifications/domain/model/value-objects/AlertType.js';

describe('createAlertType', () => {
  it.each(['CASO_ASIGNADO', 'SLA_POR_VENCER', 'APROBACION_PENDIENTE', 'RIESGO_CRITICO'] as const)(
    'accepts %s',
    (value) => {
      expect(createAlertType(value)).toBe(value);
    },
  );

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
      'CASO_ASIGNADO',
      'SLA_POR_VENCER',
      'APROBACION_PENDIENTE',
      'RIESGO_CRITICO',
    ]);
    expect(ALERT_TYPES).toHaveLength(4);
  });
});
