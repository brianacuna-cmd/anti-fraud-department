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
import { AllowAllAssigneeDirectory } from '../../../helpers/case-management/AllowAllAssigneeDirectory.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate, toDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import { generateOutboxEventId } from '../../../../src/shared/outbox/OutboxEventId.js';
import { InMemoryOutboxEventRepository } from '../../../helpers/case-management/InMemoryOutboxEventRepository.js';
import type { OutboxEventRepository } from '../../../../src/shared/outbox/OutboxEventRepository.js';
import type { OutboxEventId } from '../../../../src/shared/outbox/OutboxEventId.js';

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

function buildCreateCase(options: {
  seedConfig?: boolean;
  slaMinutes?: { low: number; medium: number; high: number; critical: number };
  outbox?: OutboxEventRepository;
  generateOutboxEventId?: () => OutboxEventId;
} = {}) {
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
    assigneeDirectory: new AllowAllAssigneeDirectory(),
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
    outbox: options.outbox,
    generateOutboxEventId: options.generateOutboxEventId,
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

describe('createCreateCaseUseCase idempotencyKey passthrough', () => {
  it('accepts an idempotencyKey and persists it on the created Case', async () => {
    const { createCase, cases } = buildCreateCase();

    const kase = await createCase({
      auth: ANALYST,
      customerId: 'customer-1',
      riskScore: 42,
      priority: 'MEDIUM',
      idempotencyKey: 'idem-key-1',
    });

    expect(kase.idempotencyKey).toBe('idem-key-1');
    expect(cases.all()[0]?.idempotencyKey).toBe('idem-key-1');
  });
});

describe('createCreateCaseUseCase idempotent short-circuit (D2/D3)', () => {
  it('short-circuits on a repeated idempotencyKey: no new Case, no re-run of routeCase/calculateSla/timeline/audit', async () => {
    const { createCase, cases, timelineRecorder, auditRecorder } = buildCreateCase();

    const first = await createCase({
      auth: ANALYST,
      customerId: 'customer-1',
      riskScore: 90,
      priority: 'HIGH',
      idempotencyKey: 'retry-key',
    });
    expect(cases.all()).toHaveLength(1);
    const timelineCountAfterFirst = timelineRecorder.all().length;
    const auditCountAfterFirst = auditRecorder.all().length;

    const second = await createCase({
      auth: ANALYST,
      customerId: 'customer-1',
      riskScore: 90,
      priority: 'HIGH',
      idempotencyKey: 'retry-key',
    });

    expect(second.id).toBe(first.id);
    expect(cases.all()).toHaveLength(1);
    expect(timelineRecorder.all()).toHaveLength(timelineCountAfterFirst);
    expect(auditRecorder.all()).toHaveLength(auditCountAfterFirst);
  });

  it('treats a whitespace-only idempotencyKey as absent (stored as null, no short-circuit)', async () => {
    const { createCase, cases } = buildCreateCase();

    await createCase({
      auth: ANALYST,
      customerId: 'customer-1',
      riskScore: 42,
      priority: 'MEDIUM',
      idempotencyKey: '   ',
    });
    const second = await createCase({
      auth: ANALYST,
      customerId: 'customer-2',
      riskScore: 42,
      priority: 'MEDIUM',
      idempotencyKey: '   ',
    });

    expect(cases.all()).toHaveLength(2);
    expect(second.idempotencyKey).toBeNull();
  });

  it('creates two independent Cases with the same idempotencyKey across different orgs', async () => {
    const cases = new InMemoryCaseRepository();
    const timelineRecorder = new InMemoryTimelineRecorder();
    const auditRecorder = new InMemoryCaseManagementAuditRecorder();
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const fraudConfig = new InMemoryOrganizationFraudConfigRepository();
    const slaTracking = new InMemoryCaseSlaTrackingRepository();
    const clock = new FixedClock(NOW);
    seedFraudConfig(fraudConfig);
    fraudConfig.seed(
      OrganizationFraudConfig.create({
        id: generateOrganizationFraudConfigId(),
        organizationId: oid('org-2'),
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
      }),
    );
    const routeCase = createRouteCaseUseCase({
      cases,
      routingRules,
      routingEngine: new NoMatchRoutingEngine(),
      timelineRecorder,
      auditRecorder,
      fraudConfig,
      assigneeDirectory: new AllowAllAssigneeDirectory(),
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

    const orgOneAuth = ANALYST;
    const orgTwoAuth = createAuthContext({ userId: oid('analyst-2'), organizationId: oid('org-2'), actorType: 'USER' });

    const first = await createCase({
      auth: orgOneAuth,
      customerId: 'customer-1',
      riskScore: 42,
      priority: 'MEDIUM',
      idempotencyKey: 'shared-key',
    });
    const second = await createCase({
      auth: orgTwoAuth,
      customerId: 'customer-1',
      riskScore: 42,
      priority: 'MEDIUM',
      idempotencyKey: 'shared-key',
    });

    expect(first.id).not.toBe(second.id);
    expect(cases.all()).toHaveLength(2);
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

describe('createCreateCaseUseCase case.created outbox', () => {
  it('writes Ingest camelCase case.created after route+SLA and never CASE_OPENED', async () => {
    const outbox = new InMemoryOutboxEventRepository();
    const { createCase, timelineRecorder } = buildCreateCase({
      outbox,
      generateOutboxEventId,
    });

    const kase = await createCase({
      auth: ANALYST,
      customerId: 'customer-1',
      customerEmail: 'a@b.com',
      bridgeUserId: 'bridge-1',
      bridgeWallet: '0xabc',
      stripeCustomerId: 'cus_1',
      riskScore: 42,
      priority: 'HIGH',
    });

    expect(outbox.all()).toHaveLength(1);
    const event = outbox.all()[0]!;
    expect(event.eventType).toBe('case.created');
    expect(event.aggregateType).toBe('Case');
    expect(event.aggregateId).toBe(kase.id);
    expect(event.organizationId).toBe(kase.organizationId);
    expect(event.payload).toEqual({
      caseId: kase.id,
      organizationId: kase.organizationId,
      customerId: 'customer-1',
      customerEmail: 'a@b.com',
      bridgeUserId: 'bridge-1',
      bridgeWallet: '0xabc',
      stripeCustomerId: 'cus_1',
      riskScore: 42,
      status: kase.status,
      priority: 'HIGH',
      assignedTo: kase.assignedTo?.id ?? null,
      createdAt: kase.createdAt,
    });
    expect(timelineRecorder.all().map((row) => row.eventType)).toEqual(['CASE_CREATED']);
  });

  it('skips outbox on idempotent replay and writes nothing when either dep is missing', async () => {
    const outbox = new InMemoryOutboxEventRepository();
    const withBoth = buildCreateCase({ outbox, generateOutboxEventId });
    await withBoth.createCase({
      auth: ANALYST,
      customerId: 'customer-1',
      riskScore: 90,
      priority: 'HIGH',
      idempotencyKey: 'retry-outbox',
    });
    await withBoth.createCase({
      auth: ANALYST,
      customerId: 'customer-1',
      riskScore: 90,
      priority: 'HIGH',
      idempotencyKey: 'retry-outbox',
    });
    expect(outbox.all()).toHaveLength(1);

    const onlyOutbox = new InMemoryOutboxEventRepository();
    await buildCreateCase({ outbox: onlyOutbox }).createCase({
      auth: ANALYST,
      customerId: 'customer-2',
      riskScore: 10,
      priority: 'LOW',
    });
    expect(onlyOutbox.all()).toHaveLength(0);
  });
});
