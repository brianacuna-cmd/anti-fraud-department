import {
  ALERT_TYPES,
  alertTypeStorageValues,
  createAlertType,
} from '../../../../../src/modules/notifications/domain/model/value-objects/AlertType.js';

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

  it.each([
    ['SLA_WARNING', 'SLA_DUE_SOON'],
    ['CRITICAL_FRAUD', 'CRITICAL_RISK'],
    ['APPROVAL_REQUIRED', 'APPROVAL_PENDING'],
  ] as const)('normalizes inbound alias %s to %s', (alias, canonical) => {
    expect(createAlertType(alias)).toBe(canonical);
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

describe('alertTypeStorageValues with multiple legacy spellings mapped to one canonical', () => {
  it('returns a stable canonical/legacy pair for SLA_DUE_SOON despite two inbound aliases', () => {
    const [canonical, legacy] = alertTypeStorageValues('SLA_DUE_SOON');
    expect(canonical).toBe('SLA_DUE_SOON');
    expect(legacy).toBe('SLA_POR_VENCER');
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
