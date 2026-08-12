import { OrganizationFraudConfig } from '../../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { createOrganizationFraudConfigId } from '../../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { CaseManagementError } from '../../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));

function buildConfig(overrides: Partial<Parameters<typeof OrganizationFraudConfig.create>[0]> = {}): OrganizationFraudConfig {
  return OrganizationFraudConfig.create({
    id: createOrganizationFraudConfigId('config-1'),
    organizationId: 'org-1',
    slaLowMinutes: 240,
    slaMediumMinutes: 120,
    slaHighMinutes: 60,
    slaCriticalMinutes: 30,
    riskThresholdLow: 25,
    riskThresholdMedium: 50,
    riskThresholdHigh: 75,
    riskThresholdCritical: 90,
    featureFlags: {},
    now: NOW,
    ...overrides,
  });
}

describe('OrganizationFraudConfig.create', () => {
  it('creates a config with all fields set', () => {
    const config = buildConfig();

    expect(config.organizationId).toBe('org-1');
    expect(config.slaLowMinutes).toBe(240);
    expect(config.slaCriticalMinutes).toBe(30);
    expect(config.riskThresholdCritical).toBe(90);
    expect(config.featureFlags).toEqual({});
    expect(config.createdAt).toBe(NOW);
    expect(config.updatedAt).toBe(NOW);
  });

  it('rejects an empty organizationId', () => {
    expect(() => buildConfig({ organizationId: '   ' })).toThrow(CaseManagementError);
  });

  it('rejects negative SLA minutes', () => {
    expect(() => buildConfig({ slaLowMinutes: -1 })).toThrow(CaseManagementError);
  });

  it('rejects negative risk thresholds', () => {
    expect(() => buildConfig({ riskThresholdLow: -1 })).toThrow(CaseManagementError);
  });
});

describe('OrganizationFraudConfig.rehydrate', () => {
  it('reconstructs from persisted props without validation', () => {
    const config = buildConfig();
    const rehydrated = OrganizationFraudConfig.rehydrate(config.toProps());

    expect(rehydrated.id).toBe(config.id);
    expect(rehydrated.organizationId).toBe(config.organizationId);
  });
});

describe('OrganizationFraudConfig#slaMinutesFor', () => {
  it('resolves SLA minutes by priority', () => {
    const config = buildConfig();

    expect(config.slaMinutesFor('LOW')).toBe(240);
    expect(config.slaMinutesFor('MEDIUM')).toBe(120);
    expect(config.slaMinutesFor('HIGH')).toBe(60);
    expect(config.slaMinutesFor('CRITICAL')).toBe(30);
  });
});

describe('OrganizationFraudConfig#update', () => {
  it('returns a new instance with updated fields and bumped updatedAt', () => {
    const config = buildConfig();

    const updated = config.update(
      {
        slaLowMinutes: 300,
        riskThresholdCritical: 95,
        featureFlags: { autoRouting: true },
      },
      LATER,
    );

    expect(updated.slaLowMinutes).toBe(300);
    expect(updated.riskThresholdCritical).toBe(95);
    expect(updated.featureFlags).toEqual({ autoRouting: true });
    expect(updated.updatedAt).toBe(LATER);
    // unchanged fields survive
    expect(updated.slaMediumMinutes).toBe(120);
    expect(updated.createdAt).toBe(NOW);
  });
});
