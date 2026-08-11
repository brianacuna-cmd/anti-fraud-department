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
  it('is bijective across exactly the four catalog entries', () => {
    const wireKeys = Object.keys(WIRE_TO_ALERT_TYPE);
    expect(wireKeys).toHaveLength(4);
    for (const wireKey of wireKeys) {
      const domainValue = WIRE_TO_ALERT_TYPE[wireKey as keyof typeof WIRE_TO_ALERT_TYPE];
      expect(ALERT_TYPE_TO_WIRE[domainValue]).toBe(wireKey);
    }
  });
});
