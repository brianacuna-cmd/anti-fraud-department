import {
  setPreferenceBodySchema,
  WIRE_TO_ALERT_TYPE,
  ALERT_TYPE_TO_WIRE,
} from '../../../../src/modules/notifications/infrastructure/adapters/inbound/http/dto/notificationPreferenceSchemas.js';

describe('setPreferenceBodySchema', () => {
  it('accepts { enabled: boolean }', () => {
    expect(setPreferenceBodySchema.safeParse({ enabled: true }).success).toBe(true);
    expect(setPreferenceBodySchema.safeParse({ enabled: false }).success).toBe(true);
  });

  it('rejects a malformed body (missing/wrong-typed enabled)', () => {
    expect(setPreferenceBodySchema.safeParse({}).success).toBe(false);
    expect(setPreferenceBodySchema.safeParse({ enabled: 'yes' }).success).toBe(false);
  });

  it('rejects extra keys (.strict())', () => {
    expect(setPreferenceBodySchema.safeParse({ enabled: true, extra: 1 }).success).toBe(false);
  });
});

describe('wire<->domain alertType casing map (design D2/D8)', () => {
  it('is bijective across the four English catalog entries', () => {
    const canonicalWireKeys = Object.values(ALERT_TYPE_TO_WIRE);
    expect(canonicalWireKeys).toHaveLength(4);
    for (const wireKey of canonicalWireKeys) {
      const domainValue = WIRE_TO_ALERT_TYPE[wireKey];
      expect(ALERT_TYPE_TO_WIRE[domainValue]).toBe(wireKey);
    }
  });

  it('maps legacy Spanish wire keys onto the English domain catalog', () => {
    expect(WIRE_TO_ALERT_TYPE.caso_asignado).toBe('CASE_ASSIGNED');
    expect(WIRE_TO_ALERT_TYPE.sla_por_vencer).toBe('SLA_DUE_SOON');
    expect(WIRE_TO_ALERT_TYPE.aprobacion_pendiente).toBe('APPROVAL_PENDING');
    expect(WIRE_TO_ALERT_TYPE.riesgo_critico).toBe('CRITICAL_RISK');
    expect(ALERT_TYPE_TO_WIRE.CASE_ASSIGNED).toBe('case_assigned');
  });
});
