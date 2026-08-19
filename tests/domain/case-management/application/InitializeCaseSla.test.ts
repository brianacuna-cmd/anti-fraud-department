import { createInitializeCaseSlaService } from '../../../../src/modules/case-management/application/InitializeCaseSla.js';
import { InMemoryCaseSlaTrackingRepository } from '../../../helpers/case-management/InMemoryCaseSlaTrackingRepository.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { OrganizationFraudConfig } from '../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { createOrganizationFraudConfigId } from '../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { CaseSlaTracking } from '../../../../src/modules/case-management/domain/model/aggregates/CaseSlaTracking.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import {
  createCaseSlaTrackingId,
  generateCaseSlaTrackingId,
} from '../../../../src/modules/case-management/domain/model/value-objects/CaseSlaTrackingId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-05-10T09:00:00.000Z'));
const CASE_ID = createCaseId('64b7f1c2e4b0a1d2c3e4f5a6');

function build(seedConfig = true) {
  const slaTracking = new InMemoryCaseSlaTrackingRepository();
  const fraudConfig = new InMemoryOrganizationFraudConfigRepository();

  if (seedConfig) {
    fraudConfig.seed(
      OrganizationFraudConfig.create({
        id: createOrganizationFraudConfigId('config-1'),
        organizationId: 'org-1',
        slaLowMinutes: 480,
        slaMediumMinutes: 240,
        slaHighMinutes: 120,
        slaCriticalMinutes: 20,
        riskThresholdLow: 25,
        riskThresholdMedium: 50,
        riskThresholdHigh: 75,
        riskThresholdCritical: 90,
        now: NOW,
      }),
    );
  }

  const initializeCaseSla = createInitializeCaseSlaService({
    slaTracking,
    fraudConfig,
    generateCaseSlaTrackingId,
  });

  return { slaTracking, fraudConfig, initializeCaseSla };
}

describe('createInitializeCaseSlaService', () => {
  it('writes an ON_TRACK tracking row using the tenant window for the priority', async () => {
    const { slaTracking, initializeCaseSla } = build();

    const dueDate = await initializeCaseSla({
      organizationId: 'org-1',
      caseId: CASE_ID,
      priority: 'CRITICAL',
      now: NOW,
    });

    expect(dueDate).toBe('2026-05-10T09:20:00.000Z');

    const rows = slaTracking.all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('ON_TRACK');
    expect(rows[0]?.caseId).toBe(CASE_ID);
    expect(rows[0]?.dueDate).toBe(dueDate);
    expect(rows[0]?.notificationSent).toBe(false);
  });

  it('falls back to the house window when the tenant has no fraud config', async () => {
    const { initializeCaseSla } = build(false);

    const dueDate = await initializeCaseSla({
      organizationId: 'org-without-config',
      caseId: CASE_ID,
      priority: 'HIGH',
      now: NOW,
    });

    // Un caso de fraude no puede quedar sin abrir porque falte configurar el tenant.
    expect(dueDate).toBe('2026-05-10T10:00:00.000Z');
  });

  it('resets the existing row instead of inserting a second one for the same case', async () => {
    const { slaTracking, initializeCaseSla } = build();
    slaTracking.seed(
      CaseSlaTracking.create({
        id: createCaseSlaTrackingId('tracking-1'),
        caseId: CASE_ID,
        dueDate: fromDate(new Date('2026-05-09T00:00:00.000Z')),
        now: fromDate(new Date('2026-05-08T00:00:00.000Z')),
      })
        .advanceTo('WARNING', NOW)
        .markNotified(NOW),
    );

    await initializeCaseSla({
      organizationId: 'org-1',
      caseId: CASE_ID,
      priority: 'MEDIUM',
      now: NOW,
    });

    const rows = slaTracking.all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(createCaseSlaTrackingId('tracking-1'));
    expect(rows[0]?.status).toBe('ON_TRACK');
    expect(rows[0]?.notificationSent).toBe(false);
    expect(rows[0]?.dueDate).toBe('2026-05-10T13:00:00.000Z');
  });

  it('resets a BREACHED row, which has no forward transition of its own', async () => {
    const { slaTracking, initializeCaseSla } = build();
    slaTracking.seed(
      CaseSlaTracking.create({
        id: createCaseSlaTrackingId('tracking-2'),
        caseId: CASE_ID,
        dueDate: fromDate(new Date('2026-05-01T00:00:00.000Z')),
        now: fromDate(new Date('2026-04-30T00:00:00.000Z')),
      })
        .advanceTo('WARNING', NOW)
        .advanceTo('BREACHED', NOW),
    );

    await expect(
      initializeCaseSla({ organizationId: 'org-1', caseId: CASE_ID, priority: 'LOW', now: NOW }),
    ).resolves.toBe('2026-05-10T17:00:00.000Z');

    expect(slaTracking.all()[0]?.status).toBe('ON_TRACK');
  });
});
