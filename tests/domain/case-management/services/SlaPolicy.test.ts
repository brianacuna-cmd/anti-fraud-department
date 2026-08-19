import {
  DEFAULT_SLA_WINDOW_MINUTES,
  resolveSlaDueDate,
  slaWindowFromConfig,
} from '../../../../src/modules/case-management/domain/services/SlaPolicy.js';
import { OrganizationFraudConfig } from '../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { createOrganizationFraudConfigId } from '../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-03-01T12:00:00.000Z'));

const config = OrganizationFraudConfig.create({
  id: createOrganizationFraudConfigId('config-1'),
  organizationId: 'org-1',
  slaLowMinutes: 600,
  slaMediumMinutes: 300,
  slaHighMinutes: 90,
  slaCriticalMinutes: 15,
  riskThresholdLow: 25,
  riskThresholdMedium: 50,
  riskThresholdHigh: 75,
  riskThresholdCritical: 90,
  now: NOW,
});

describe('slaWindowFromConfig', () => {
  it('projects the tenant config onto the priority-keyed window', () => {
    expect(slaWindowFromConfig(config)).toEqual({
      LOW: 600,
      MEDIUM: 300,
      HIGH: 90,
      CRITICAL: 15,
    });
  });

  it('falls back to the house defaults when the tenant has no config', () => {
    expect(slaWindowFromConfig(null)).toEqual(DEFAULT_SLA_WINDOW_MINUTES);
  });
});

describe('resolveSlaDueDate', () => {
  it.each([
    ['LOW', '2026-03-01T22:00:00.000Z'],
    ['MEDIUM', '2026-03-01T17:00:00.000Z'],
    ['HIGH', '2026-03-01T13:30:00.000Z'],
    ['CRITICAL', '2026-03-01T12:15:00.000Z'],
  ] as const)('adds the %s window to now', (priority, expected) => {
    expect(resolveSlaDueDate(slaWindowFromConfig(config), priority, NOW)).toBe(expected);
  });

  it('adds exact minutes across a DST boundary rather than a wall-clock hour', () => {
    // 2026-03-08 02:00 America/New_York is the US spring-forward instant.
    const beforeDst = fromDate(new Date('2026-03-08T06:30:00.000Z'));
    const due = resolveSlaDueDate({ LOW: 60, MEDIUM: 60, HIGH: 60, CRITICAL: 60 }, 'HIGH', beforeDst);
    expect(new Date(due).getTime() - new Date(beforeDst).getTime()).toBe(3_600_000);
  });
});
