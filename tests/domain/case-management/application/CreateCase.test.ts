import { oid } from '../../../support/oid.js';
import { createCreateCaseUseCase } from '../../../../src/modules/case-management/application/CreateCase.js';
import { createCalculateSlaUseCase } from '../../../../src/modules/case-management/application/CalculateSla.js';
import { createRouteCaseUseCase } from '../../../../src/modules/case-management/application/RouteCase.js';
import type { RoutingEngine, RoutingEvaluation } from '../../../../src/modules/case-management/domain/ports/RoutingEngine.js';
import { OrganizationFraudConfig } from '../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { generateCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { generateCaseSlaTrackingId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseSlaTrackingId.js';
import { generateOrganizationFraudConfigId } from '../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryCaseRoutingRuleRepository } from '../../../helpers/case-management/InMemoryCaseRoutingRuleRepository.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { InMemoryCaseSlaTrackingRepository } from '../../../helpers/case-management/InMemoryCaseSlaTrackingRepository.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate, toDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: oid('org-1'), actorType: 'USER' });

class NoMatchRoutingEngine implements RoutingEngine {
  async evaluate(): Promise<RoutingEvaluation> {
    return { targetUserId: null, targetRoleId: null };
  }
}

function seedFraudConfig(
  fraudConfig: InMemoryOrganizationFraudConfigRepository,
  minutes: { low: number; medium: number; high: number; critical: number } = {
    low: 240,
    medium: 120,
    high: 60,
    critical: 30,
  },
): void {
  fraudConfig.seed(
    OrganizationFraudConfig.create({
      id: generateOrganizationFraudConfigId(),
      organizationId: oid('org-1'),
      slaLowMinutes: minutes.low,
      slaMediumMinutes: minutes.medium,
      slaHighMinutes: minutes.high,
      slaCriticalMinutes: minutes.critical,
      riskThresholdLow: 25,
      riskThresholdMedium: 50,
      riskThresholdHigh: 75,
      riskThresholdCritical: 90,
      featureFlags: {},
      now: NOW,
    }),
  );
}

function buildCreateCase(options: { seedConfig?: boolean; slaMinutes?: { low: number; medium: number; high: number; critical: number } } = {}) {
  const cases = new InMemoryCaseRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const routingRules = new InMemoryCaseRoutingRuleRepository();
  const fraudConfig = new InMemoryOrganizationFraudConfigRepository();
  const slaTracking = new InMemoryCaseSlaTrackingRepository();
  const clock = new FixedClock(NOW);

  if (options.seedConfig !== false) {
    seedFraudConfig(fraudConfig, options.slaMinutes);
  }

  const routeCase = createRouteCaseUseCase({
    cases,
    routingRules,
    routingEngine: new NoMatchRoutingEngine(),
    timelineRecorder,
    auditRecorder,
    fraudConfig,
    clock,
    generateTimelineEventId,
  });
  const calculateSla = createCalculateSlaUseCase({
    cases,
    slaTracking,
    fraudConfig,
    clock,
    generateCaseSlaTrackingId,
  });

  const createCase = createCreateCaseUseCase({
    cases,
    timelineRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock,
    generateCaseId,
    generateTimelineEventId,
    auditRecorder,
    routeCase,
    calculateSla,
  });

  return { createCase, cases, slaTracking, timelineRecorder, auditRecorder };
}

describe('createCreateCaseUseCase (T2 SLA after RouteCase)', () => {
  it('sets dueDate and creates ON_TRACK SLA tracking after routing when fraud config exists', async () => {
    const { createCase, cases, slaTracking } = buildCreateCase({
      slaMinutes: { low: 240, medium: 120, high: 60, critical: 30 },
    });

    const kase = await createCase({
      auth: ANALYST,
      customerId: 'customer-1',
      riskScore: 42,
      priority: 'HIGH',
    });

    const expectedDue = fromDate(new Date(toDate(NOW).getTime() + 60 * 60_000));
    expect(kase.dueDate).toBe(expectedDue);
    expect(cases.all()[0]?.dueDate).toBe(expectedDue);

    const tracking = slaTracking.all();
    expect(tracking).toHaveLength(1);
    expect(tracking[0]?.caseId).toBe(kase.id);
    expect(tracking[0]?.status).toBe('ON_TRACK');
    expect(tracking[0]?.dueDate).toBe(expectedDue);
  });

  it('uses each priority\'s minutes when creating cases at different priorities', async () => {
    const { createCase } = buildCreateCase({
      slaMinutes: { low: 240, medium: 120, high: 60, critical: 15 },
    });

    const low = await createCase({ auth: ANALYST, customerId: 'c-low', riskScore: 10, priority: 'LOW' });
    const critical = await createCase({
      auth: ANALYST,
      customerId: 'c-crit',
      riskScore: 99,
      priority: 'CRITICAL',
    });

    expect(low.dueDate).toBe(fromDate(new Date(toDate(NOW).getTime() + 240 * 60_000)));
    expect(critical.dueDate).toBe(fromDate(new Date(toDate(NOW).getTime() + 15 * 60_000)));
  });

  it('fails closed with ORGANIZATION_FRAUD_CONFIG_NOT_FOUND and creates no SLA row when config is missing', async () => {
    const { createCase, slaTracking } = buildCreateCase({ seedConfig: false });

    expect.assertions(3);
    try {
      await createCase({ auth: ANALYST, customerId: 'customer-1', riskScore: 42, priority: 'HIGH' });
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('ORGANIZATION_FRAUD_CONFIG_NOT_FOUND');
    }
    expect(slaTracking.all()).toHaveLength(0);
  });
});

describe('createCreateCaseUseCase optional finturuCacheSnapshot', () => {
  it('persists finturuCacheSnapshot and caller-supplied priority when provided (automated path)', async () => {
    const { createCase, cases } = buildCreateCase();
    const snapshot = {
      event: { provider: 'stripe', caseCustomerId: 'cust-1' },
      ruleId: 'rule-1',
      conditionsVersion: 3,
      riskScore: 88,
      hits: [{ id: 'hit-1' }],
    };

    const kase = await createCase({
      auth: ANALYST,
      customerId: 'customer-1',
      riskScore: 88,
      priority: 'CRITICAL',
      finturuCacheSnapshot: snapshot,
    });

    expect(kase.priority).toBe('CRITICAL');
    expect(kase.finturuCacheSnapshot).toEqual(snapshot);
    expect(cases.all()[0]?.finturuCacheSnapshot).toEqual(snapshot);
  });

  it('leaves finturuCacheSnapshot null when omitted (manual path regression)', async () => {
    const { createCase, cases } = buildCreateCase();

    const kase = await createCase({
      auth: ANALYST,
      customerId: 'customer-1',
      riskScore: 42,
      priority: 'MEDIUM',
    });

    expect(kase.finturuCacheSnapshot).toBeNull();
    expect(cases.all()[0]?.finturuCacheSnapshot).toBeNull();
    expect(kase.priority).toBe('MEDIUM');
  });
});
