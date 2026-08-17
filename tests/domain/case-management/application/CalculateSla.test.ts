import { oid } from '../../../support/oid.js';
import { createCalculateSlaUseCase } from '../../../../src/modules/case-management/application/CalculateSla.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { OrganizationFraudConfig } from '../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { generateCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { createCasePriority } from '../../../../src/modules/case-management/domain/model/value-objects/CasePriority.js';
import { generateCaseSlaTrackingId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseSlaTrackingId.js';
import { generateOrganizationFraudConfigId } from '../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryCaseSlaTrackingRepository } from '../../../helpers/case-management/InMemoryCaseSlaTrackingRepository.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate, toDate } from '../../../../src/shared/time/Instant.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG = oid('org-1');
const NO_TX = undefined as never;

function buildCase(priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'HIGH'): Case {
  return Case.create({
    id: generateCaseId(),
    organizationId: ORG,
    customerId: 'customer-1',
    riskScore: createRiskScore(90),
    priority: createCasePriority(priority),
    now: NOW,
  });
}

function buildFraudConfig(overrides: Partial<{
  slaLowMinutes: number;
  slaMediumMinutes: number;
  slaHighMinutes: number;
  slaCriticalMinutes: number;
}> = {}): OrganizationFraudConfig {
  return OrganizationFraudConfig.create({
    id: generateOrganizationFraudConfigId(),
    organizationId: ORG,
    slaLowMinutes: overrides.slaLowMinutes ?? 240,
    slaMediumMinutes: overrides.slaMediumMinutes ?? 120,
    slaHighMinutes: overrides.slaHighMinutes ?? 60,
    slaCriticalMinutes: overrides.slaCriticalMinutes ?? 30,
    riskThresholdLow: 25,
    riskThresholdMedium: 50,
    riskThresholdHigh: 75,
    riskThresholdCritical: 90,
    featureFlags: {},
    now: NOW,
  });
}

function buildUseCase(fraudConfigSeed?: OrganizationFraudConfig) {
  const cases = new InMemoryCaseRepository();
  const slaTracking = new InMemoryCaseSlaTrackingRepository();
  const fraudConfig = new InMemoryOrganizationFraudConfigRepository();
  if (fraudConfigSeed !== undefined) {
    fraudConfig.seed(fraudConfigSeed);
  }
  const calculateSla = createCalculateSlaUseCase({
    cases,
    slaTracking,
    fraudConfig,
    clock: new FixedClock(NOW),
    generateCaseSlaTrackingId,
  });
  return { calculateSla, cases, slaTracking, fraudConfig };
}

describe('createCalculateSlaUseCase', () => {
  it('sets dueDate from priority minutes and creates an ON_TRACK CaseSlaTracking row', async () => {
    const { calculateSla, cases, slaTracking } = buildUseCase(buildFraudConfig({ slaHighMinutes: 60 }));
    const kase = buildCase('HIGH');

    const result = await calculateSla({ kase, tx: NO_TX });

    const expectedDue = fromDate(new Date(toDate(NOW).getTime() + 60 * 60_000));
    expect(result.dueDate).toBe(expectedDue);
    expect(cases.all()).toHaveLength(1);
    expect(cases.all()[0]?.dueDate).toBe(expectedDue);

    const tracking = slaTracking.all();
    expect(tracking).toHaveLength(1);
    expect(tracking[0]?.caseId).toBe(kase.id);
    expect(tracking[0]?.status).toBe('ON_TRACK');
    expect(tracking[0]?.dueDate).toBe(expectedDue);
    expect(tracking[0]?.notifiedStatuses.size).toBe(0);
  });

  it('maps each priority to its distinct SLA minutes when computing dueDate', async () => {
    const { calculateSla } = buildUseCase(
      buildFraudConfig({
        slaLowMinutes: 240,
        slaMediumMinutes: 120,
        slaHighMinutes: 60,
        slaCriticalMinutes: 30,
      }),
    );

    const low = await calculateSla({ kase: buildCase('LOW'), tx: NO_TX });
    const medium = await calculateSla({ kase: buildCase('MEDIUM'), tx: NO_TX });
    const high = await calculateSla({ kase: buildCase('HIGH'), tx: NO_TX });
    const critical = await calculateSla({ kase: buildCase('CRITICAL'), tx: NO_TX });

    expect(low.dueDate).toBe(fromDate(new Date(toDate(NOW).getTime() + 240 * 60_000)));
    expect(medium.dueDate).toBe(fromDate(new Date(toDate(NOW).getTime() + 120 * 60_000)));
    expect(high.dueDate).toBe(fromDate(new Date(toDate(NOW).getTime() + 60 * 60_000)));
    expect(critical.dueDate).toBe(fromDate(new Date(toDate(NOW).getTime() + 30 * 60_000)));
  });

  it('throws ORGANIZATION_FRAUD_CONFIG_NOT_FOUND and persists nothing when config is missing', async () => {
    const { calculateSla, cases, slaTracking } = buildUseCase();
    const kase = buildCase('HIGH');

    expect.assertions(4);
    try {
      await calculateSla({ kase, tx: NO_TX });
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('ORGANIZATION_FRAUD_CONFIG_NOT_FOUND');
    }
    expect(cases.all()).toHaveLength(0);
    expect(slaTracking.all()).toHaveLength(0);
  });
});
