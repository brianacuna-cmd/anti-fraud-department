import { OrganizationScreeningConfig } from '../../../../../src/modules/screening/domain/model/aggregates/OrganizationScreeningConfig.js';
import { createOrganizationScreeningConfigId } from '../../../../../src/modules/screening/domain/model/value-objects/OrganizationScreeningConfigId.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));

function buildInput(overrides: Partial<{ alertThreshold: number; signalThreshold: number }> = {}) {
  return {
    id: createOrganizationScreeningConfigId('507f1f77bcf86cd799439011'),
    organizationId: '507f1f77bcf86cd799439012',
    alertThreshold: 40,
    signalThreshold: 80,
    now: NOW,
    ...overrides,
  };
}

describe('OrganizationScreeningConfig', () => {
  it('creates with valid thresholds', () => {
    const config = OrganizationScreeningConfig.create(buildInput());

    expect(config.alertThreshold).toBe(40);
    expect(config.signalThreshold).toBe(80);
    expect(config.createdAt).toBe(NOW);
    expect(config.updatedAt).toBe(NOW);
  });

  it('allows alertThreshold === signalThreshold (boundary)', () => {
    const config = OrganizationScreeningConfig.create(
      buildInput({ alertThreshold: 50, signalThreshold: 50 }),
    );

    expect(config.alertThreshold).toBe(50);
    expect(config.signalThreshold).toBe(50);
  });

  it('rejects alertThreshold > signalThreshold', () => {
    expect(() =>
      OrganizationScreeningConfig.create(buildInput({ alertThreshold: 80, signalThreshold: 40 })),
    ).toThrow(/alertThreshold/);
  });

  it('rejects thresholds outside [0, 100]', () => {
    expect(() =>
      OrganizationScreeningConfig.create(buildInput({ alertThreshold: -1 })),
    ).toThrow();
    expect(() =>
      OrganizationScreeningConfig.create(buildInput({ signalThreshold: 101 })),
    ).toThrow();
  });

  it('rehydrates without re-validating (persistence round-trip)', () => {
    const config = OrganizationScreeningConfig.rehydrate({
      id: createOrganizationScreeningConfigId('507f1f77bcf86cd799439011'),
      organizationId: '507f1f77bcf86cd799439012',
      alertThreshold: 40,
      signalThreshold: 80,
      createdAt: NOW,
      updatedAt: LATER,
    });

    expect(config.alertThreshold).toBe(40);
    expect(config.updatedAt).toBe(LATER);
  });
});
