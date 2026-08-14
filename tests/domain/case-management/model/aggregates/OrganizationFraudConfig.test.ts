import { oid } from '../../../../support/oid.js';
import { OrganizationFraudConfig } from '../../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { createOrganizationFraudConfigId } from '../../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { CaseManagementError } from '../../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));

function buildConfig(overrides: Partial<Parameters<typeof OrganizationFraudConfig.create>[0]> = {}): OrganizationFraudConfig {
  return OrganizationFraudConfig.create({
    id: createOrganizationFraudConfigId(oid('config-1')),
    organizationId: oid('org-1'),
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

    expect(config.organizationId).toBe(oid('org-1'));
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

describe('OrganizationFraudConfig#priorityForRiskScore', () => {
  // Thresholds: low=25, medium=50, high=75, critical=90
  it('returns the highest band crossed (critical ≥ high ≥ medium ≥ low)', () => {
    const config = buildConfig();

    expect(config.priorityForRiskScore(90)).toBe('CRITICAL');
    expect(config.priorityForRiskScore(100)).toBe('CRITICAL');
    expect(config.priorityForRiskScore(75)).toBe('HIGH');
    expect(config.priorityForRiskScore(89)).toBe('HIGH');
    expect(config.priorityForRiskScore(50)).toBe('MEDIUM');
    expect(config.priorityForRiskScore(74)).toBe('MEDIUM');
    expect(config.priorityForRiskScore(25)).toBe('LOW');
    expect(config.priorityForRiskScore(49)).toBe('LOW');
  });

  it('returns null when score is below risk_threshold_low (no case open)', () => {
    const config = buildConfig();

    expect(config.priorityForRiskScore(24)).toBeNull();
    expect(config.priorityForRiskScore(0)).toBeNull();
  });

  it('uses the org config thresholds, not hardcoded bands', () => {
    const config = buildConfig({
      riskThresholdLow: 10,
      riskThresholdMedium: 20,
      riskThresholdHigh: 30,
      riskThresholdCritical: 40,
    });

    expect(config.priorityForRiskScore(40)).toBe('CRITICAL');
    expect(config.priorityForRiskScore(30)).toBe('HIGH');
    expect(config.priorityForRiskScore(20)).toBe('MEDIUM');
    expect(config.priorityForRiskScore(10)).toBe('LOW');
    expect(config.priorityForRiskScore(9)).toBeNull();
  });
});
