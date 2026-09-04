import { createRouteCaseUseCase } from '../../../../src/modules/case-management/application/RouteCase.js';
import type {
  CaseRoutingContext,
  RoutingEngine,
  RoutingEvaluation,
} from '../../../../src/modules/case-management/domain/ports/RoutingEngine.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { CaseRoutingRule } from '../../../../src/modules/case-management/domain/model/aggregates/CaseRoutingRule.js';
import { generateCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { generateCaseRoutingRuleId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseRoutingRuleId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { createCasePriority } from '../../../../src/modules/case-management/domain/model/value-objects/CasePriority.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseRoutingRuleRepository } from '../../../helpers/case-management/InMemoryCaseRoutingRuleRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { InMemoryAssigneeDirectory } from '../../../helpers/case-management/InMemoryAssigneeDirectory.js';
import { AllowAllAssigneeDirectory } from '../../../helpers/case-management/AllowAllAssigneeDirectory.js';
import type { AssigneeDirectory } from '../../../../src/modules/case-management/domain/ports/AssigneeDirectory.js';
import { OrganizationFraudConfig } from '../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { generateOrganizationFraudConfigId } from '../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG = 'org-1';

/** Returns a preset evaluation per `evaluate` call, in order — models ZEN outputs deterministically. */
class ScriptedRoutingEngine implements RoutingEngine {
  private readonly queue: RoutingEvaluation[];
  readonly contexts: CaseRoutingContext[] = [];

  constructor(evaluations: RoutingEvaluation[]) {
    this.queue = [...evaluations];
  }

  async evaluate(
    _conditions: Readonly<Record<string, unknown>>,
    context: CaseRoutingContext,
  ): Promise<RoutingEvaluation> {
    this.contexts.push(context);
    return this.queue.shift() ?? { targetUserId: null, targetRoleId: null };
  }
}

function buildCase(): Case {
  return Case.create({
    id: generateCaseId(),
    organizationId: ORG,
    customerId: 'customer-1',
    riskScore: createRiskScore(90),
    priority: createCasePriority('HIGH'),
    tags: ['fraud'],
    now: NOW,
  });
}

function buildRule(overrides: Partial<Parameters<typeof CaseRoutingRule.create>[0]> = {}): CaseRoutingRule {
  return CaseRoutingRule.create({
    id: generateCaseRoutingRuleId(),
    organizationId: ORG,
    name: 'rule',
    conditions: {},
    conditionsVersion: 1,
    status: 'ACTIVE',
    now: NOW,
    ...overrides,
  });
}

/** Always throws — models a rule whose JDM cannot be compiled or evaluated. */
class ThrowingRoutingEngine implements RoutingEngine {
  async evaluate(): Promise<RoutingEvaluation> {
    throw new Error('invalid JDM graph');
  }
}

/** Throws on the first rule only — models one unusable rule followed by a healthy one. */
class ThrowingOnceRoutingEngine implements RoutingEngine {
  private calls = 0;

  constructor(private readonly then: RoutingEvaluation) {}

  async evaluate(): Promise<RoutingEvaluation> {
    this.calls += 1;
    if (this.calls === 1) {
      throw new Error('invalid JDM graph');
    }
    return this.then;
  }
}

function buildFraudConfig(featureFlags: Record<string, boolean>): OrganizationFraudConfig {
  return OrganizationFraudConfig.create({
    id: generateOrganizationFraudConfigId(),
    organizationId: ORG,
    slaLowMinutes: 1,
    slaMediumMinutes: 1,
    slaHighMinutes: 1,
    slaCriticalMinutes: 1,
    riskThresholdLow: 1,
    riskThresholdMedium: 1,
    riskThresholdHigh: 1,
    riskThresholdCritical: 1,
    featureFlags,
    now: NOW,
  });
}

function buildUseCase(
  engine: RoutingEngine,
  rules: CaseRoutingRule[],
  fraudConfigSeed?: OrganizationFraudConfig,
  assigneeDirectory: AssigneeDirectory = new AllowAllAssigneeDirectory(),
) {
  const cases = new InMemoryCaseRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const routingRules = new InMemoryCaseRoutingRuleRepository();
  rules.forEach((rule) => routingRules.add(rule));
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const fraudConfig = new InMemoryOrganizationFraudConfigRepository();
  if (fraudConfigSeed !== undefined) {
    fraudConfig.seed(fraudConfigSeed);
  }
  const routeCase = createRouteCaseUseCase({
    cases,
    routingRules,
    routingEngine: engine,
    timelineRecorder,
    auditRecorder,
    fraudConfig,
    assigneeDirectory,
    clock: new FixedClock(NOW),
    generateTimelineEventId,
  });
  return { routeCase, cases, timelineRecorder, auditRecorder };
}

const NO_TX = undefined as never;

/** Every test routes as a USER-triggered request; only `createdBy` stays system-null. */
const ROUTE = { tx: NO_TX, createdBy: null, actorType: 'USER', ipAddress: null } as const;

describe('createRouteCaseUseCase (T1 auto-routing)', () => {
  it('returns the case unchanged and records no timeline when the org has no active rules', async () => {
    const { routeCase, cases, timelineRecorder } = buildUseCase(new ScriptedRoutingEngine([]), []);
    const kase = buildCase();

    const result = await routeCase({ kase, ...ROUTE });

    expect(result.assignedTo).toBeNull();
    expect(timelineRecorder.all()).toHaveLength(0);
    expect(cases.all()).toHaveLength(0);
  });

  it('assigns AssignedTo=USER and appends an ASSIGNED timeline event when a rule yields a targetUserId', async () => {
    const engine = new ScriptedRoutingEngine([{ targetUserId: 'user-9', targetRoleId: null }]);
    const { routeCase, cases, timelineRecorder } = buildUseCase(engine, [buildRule()]);
    const kase = buildCase();

    const result = await routeCase({ kase, ...ROUTE });

    expect(result.assignedTo).toEqual({ type: 'USER', id: 'user-9' });
    expect(cases.all()).toHaveLength(1);
    const events = timelineRecorder.all();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('ASSIGNED');
    expect(events[0]?.newValue).toBe('user-9');
    expect(engine.contexts[0]).toMatchObject({ riskScore: 90, status: 'OPEN', priority: 'HIGH', tags: ['fraud'] });
  });

  it('assigns AssignedTo=ROLE when a rule yields a targetRoleId', async () => {
    const engine = new ScriptedRoutingEngine([{ targetUserId: null, targetRoleId: 'role-3' }]);
    const { routeCase } = buildUseCase(engine, [buildRule()]);

    const result = await routeCase({ kase: buildCase(), ...ROUTE });

    expect(result.assignedTo).toEqual({ type: 'ROLE', id: 'role-3' });
  });

  it('falls back to the rule-level target when the JDM output omits both targets', async () => {
    const engine = new ScriptedRoutingEngine([{ targetUserId: null, targetRoleId: null }]);
    const { routeCase } = buildUseCase(engine, [buildRule({ targetUserId: 'fallback-user' })]);

    const result = await routeCase({ kase: buildCase(), ...ROUTE });

    expect(result.assignedTo).toEqual({ type: 'USER', id: 'fallback-user' });
  });

  it('is first-match-wins: skips a non-matching rule and assigns from the next matching one', async () => {
    const engine = new ScriptedRoutingEngine([
      { targetUserId: null, targetRoleId: null },
      { targetUserId: 'user-2', targetRoleId: null },
    ]);
    const { routeCase } = buildUseCase(engine, [buildRule(), buildRule()]);

    const result = await routeCase({ kase: buildCase(), ...ROUTE });

    expect(result.assignedTo).toEqual({ type: 'USER', id: 'user-2' });
  });

  it('stops at the first matching rule and does not evaluate later rules', async () => {
    const engine = new ScriptedRoutingEngine([
      { targetUserId: 'user-1', targetRoleId: null },
      { targetUserId: 'user-2', targetRoleId: null },
    ]);
    const { routeCase } = buildUseCase(engine, [buildRule(), buildRule()]);

    const result = await routeCase({ kase: buildCase(), ...ROUTE });

    expect(result.assignedTo).toEqual({ type: 'USER', id: 'user-1' });
    expect(engine.contexts).toHaveLength(1);
  });

  it('evaluates ACTIVE rules in executionOrder so a later-created B wins after reorder ahead of A', async () => {
    const earlier = fromDate(new Date('2026-01-01T00:00:00.000Z'));
    const later = fromDate(new Date('2026-01-02T00:00:00.000Z'));
    const ruleA = buildRule({
      name: 'A',
      now: earlier,
      executionOrder: 1,
      targetUserId: 'user-a',
    });
    const ruleB = buildRule({
      name: 'B',
      now: later,
      executionOrder: 0,
      targetUserId: 'user-b',
    });
    const engine = new ScriptedRoutingEngine([
      { targetUserId: null, targetRoleId: null },
      { targetUserId: null, targetRoleId: null },
    ]);
    const { routeCase } = buildUseCase(engine, [ruleA, ruleB]);

    const result = await routeCase({ kase: buildCase(), ...ROUTE });

    expect(result.assignedTo).toEqual({ type: 'USER', id: 'user-b' });
    expect(engine.contexts).toHaveLength(1);
  });

  it('still prefers earlier created_at when executionOrder ties', async () => {
    const earlier = fromDate(new Date('2026-01-01T00:00:00.000Z'));
    const later = fromDate(new Date('2026-01-02T00:00:00.000Z'));
    const ruleA = buildRule({ name: 'A', now: earlier, executionOrder: 0, targetUserId: 'user-a' });
    const ruleB = buildRule({ name: 'B', now: later, executionOrder: 0, targetUserId: 'user-b' });
    const engine = new ScriptedRoutingEngine([
      { targetUserId: null, targetRoleId: null },
      { targetUserId: null, targetRoleId: null },
    ]);
    const { routeCase } = buildUseCase(engine, [ruleB, ruleA]);

    const result = await routeCase({ kase: buildCase(), ...ROUTE });

    expect(result.assignedTo).toEqual({ type: 'USER', id: 'user-a' });
    expect(engine.contexts).toHaveLength(1);
  });

  it('records a REASSIGN_CASE audit row carrying the winning rule id, name and conditionsVersion', async () => {
    const engine = new ScriptedRoutingEngine([{ targetUserId: 'user-9', targetRoleId: null }]);
    const rule = buildRule({ name: 'high-risk-to-fraud-lead', conditionsVersion: 7 });
    const { routeCase, auditRecorder } = buildUseCase(engine, [rule]);

    await routeCase({ kase: buildCase(), ...ROUTE });

    const events = auditRecorder.all();
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('REASSIGN_CASE');
    expect(events[0]?.resource).toBe('case');
    expect(events[0]?.detail).toMatchObject({
      trigger: 'AUTO_ROUTING',
      ruleId: rule.id,
      ruleName: 'high-risk-to-fraud-lead',
      conditionsVersion: 7,
      assignedToId: 'user-9',
      assignedToType: 'USER',
    });
  });

  it('emits no audit row when no rule matches', async () => {
    const engine = new ScriptedRoutingEngine([{ targetUserId: null, targetRoleId: null }]);
    const { routeCase, auditRecorder } = buildUseCase(engine, [buildRule()]);

    await routeCase({ kase: buildCase(), ...ROUTE });

    expect(auditRecorder.all()).toHaveLength(0);
  });

  describe('malformed rule isolation', () => {
    it('skips a rule whose JDM fails to evaluate instead of propagating, leaving the case unassigned', async () => {
      const { routeCase, cases, timelineRecorder } = buildUseCase(new ThrowingRoutingEngine(), [buildRule()]);

      const result = await routeCase({ kase: buildCase(), ...ROUTE });

      expect(result.assignedTo).toBeNull();
      expect(cases.all()).toHaveLength(0);
      expect(timelineRecorder.all()).toHaveLength(0);
    });

    it('audits the skipped rule as ROUTING_RULE_EVALUATION_FAILED with the engine reason', async () => {
      const rule = buildRule({ name: 'broken-rule', conditionsVersion: 3 });
      const { routeCase, auditRecorder } = buildUseCase(new ThrowingRoutingEngine(), [rule]);

      await routeCase({ kase: buildCase(), ...ROUTE });

      const events = auditRecorder.all();
      expect(events).toHaveLength(1);
      expect(events[0]?.action).toBe('ROUTING_RULE_EVALUATION_FAILED');
      expect(events[0]?.resource).toBe('rule');
      expect(events[0]?.resourceId).toBe(rule.id);
      expect(events[0]?.detail).toMatchObject({
        ruleName: 'broken-rule',
        conditionsVersion: 3,
        reason: 'invalid JDM graph',
      });
    });

    it('ignores the rule-level fallback target of a rule that failed to evaluate', async () => {
      const { routeCase } = buildUseCase(new ThrowingRoutingEngine(), [
        buildRule({ targetUserId: 'fallback-user' }),
      ]);

      const result = await routeCase({ kase: buildCase(), ...ROUTE });

      expect(result.assignedTo).toBeNull();
    });

    it('still routes from a later healthy rule when an earlier one is unusable', async () => {
      const engine = new ThrowingOnceRoutingEngine({ targetUserId: 'user-rescue', targetRoleId: null });
      const { routeCase } = buildUseCase(engine, [buildRule(), buildRule()]);

      const result = await routeCase({ kase: buildCase(), ...ROUTE });

      expect(result.assignedTo).toEqual({ type: 'USER', id: 'user-rescue' });
    });
  });

  describe('featureFlags.autoRouting opt-out', () => {
    it('skips routing entirely when the tenant set autoRouting to false', async () => {
      const engine = new ScriptedRoutingEngine([{ targetUserId: 'user-9', targetRoleId: null }]);
      const { routeCase, cases, timelineRecorder } = buildUseCase(
        engine,
        [buildRule()],
        buildFraudConfig({ autoRouting: false }),
      );

      const result = await routeCase({ kase: buildCase(), ...ROUTE });

      expect(result.assignedTo).toBeNull();
      expect(engine.contexts).toHaveLength(0);
      expect(cases.all()).toHaveLength(0);
      expect(timelineRecorder.all()).toHaveLength(0);
    });

    it('routes when the flag is explicitly true', async () => {
      const engine = new ScriptedRoutingEngine([{ targetUserId: 'user-9', targetRoleId: null }]);
      const { routeCase } = buildUseCase(engine, [buildRule()], buildFraudConfig({ autoRouting: true }));

      const result = await routeCase({ kase: buildCase(), ...ROUTE });

      expect(result.assignedTo).toEqual({ type: 'USER', id: 'user-9' });
    });

    it('routes when a config exists but declares no autoRouting flag (absent != disabled)', async () => {
      const engine = new ScriptedRoutingEngine([{ targetUserId: 'user-9', targetRoleId: null }]);
      const { routeCase } = buildUseCase(engine, [buildRule()], buildFraudConfig({}));

      const result = await routeCase({ kase: buildCase(), ...ROUTE });

      expect(result.assignedTo).toEqual({ type: 'USER', id: 'user-9' });
    });

    it('routes when persisted featureFlags is null (legacy docs; missing != disabled)', async () => {
      const seeded = buildFraudConfig({});
      const legacy = OrganizationFraudConfig.rehydrate({
        id: seeded.id,
        organizationId: seeded.organizationId,
        slaLowMinutes: seeded.slaLowMinutes,
        slaMediumMinutes: seeded.slaMediumMinutes,
        slaHighMinutes: seeded.slaHighMinutes,
        slaCriticalMinutes: seeded.slaCriticalMinutes,
        riskThresholdLow: seeded.riskThresholdLow,
        riskThresholdMedium: seeded.riskThresholdMedium,
        riskThresholdHigh: seeded.riskThresholdHigh,
        riskThresholdCritical: seeded.riskThresholdCritical,
        featureFlags: null as unknown as Record<string, boolean>,
        outboundWebhookUrl: seeded.outboundWebhookUrl,
        outboundWebhookSecret: seeded.outboundWebhookSecret,
        createdAt: seeded.createdAt,
        updatedAt: seeded.updatedAt,
      });
      const engine = new ScriptedRoutingEngine([{ targetUserId: 'user-9', targetRoleId: null }]);
      const { routeCase } = buildUseCase(engine, [buildRule()], legacy);

      const result = await routeCase({ kase: buildCase(), ...ROUTE });

      expect(result.assignedTo).toEqual({ type: 'USER', id: 'user-9' });
    });

    it('routes when the tenant has no fraud config at all (missing != disabled)', async () => {
      const engine = new ScriptedRoutingEngine([{ targetUserId: 'user-9', targetRoleId: null }]);
      const { routeCase } = buildUseCase(engine, [buildRule()]);

      const result = await routeCase({ kase: buildCase(), ...ROUTE });

      expect(result.assignedTo).toEqual({ type: 'USER', id: 'user-9' });
    });
  });

  describe('target validation', () => {
    it('skips a rule whose resolved target does not belong to the organization, leaving the case unassigned', async () => {
      const engine = new ScriptedRoutingEngine([{ targetUserId: 'ghost-user', targetRoleId: null }]);
      const directory = new InMemoryAssigneeDirectory(); // nothing allowed
      const { routeCase, cases, timelineRecorder } = buildUseCase(
        engine,
        [buildRule()],
        undefined,
        directory,
      );

      const result = await routeCase({ kase: buildCase(), ...ROUTE });

      expect(result.assignedTo).toBeNull();
      expect(cases.all()).toHaveLength(0);
      expect(timelineRecorder.all()).toHaveLength(0);
    });

    it('audits the skipped rule as ROUTING_RULE_TARGET_INVALID', async () => {
      const engine = new ScriptedRoutingEngine([{ targetUserId: 'ghost-user', targetRoleId: null }]);
      const rule = buildRule({ name: 'stale-rule', conditionsVersion: 5 });
      const directory = new InMemoryAssigneeDirectory();
      const { routeCase, auditRecorder } = buildUseCase(engine, [rule], undefined, directory);

      await routeCase({ kase: buildCase(), ...ROUTE });

      const events = auditRecorder.all();
      expect(events).toHaveLength(1);
      expect(events[0]?.action).toBe('ROUTING_RULE_TARGET_INVALID');
      expect(events[0]?.resource).toBe('rule');
      expect(events[0]?.resourceId).toBe(rule.id);
      expect(events[0]?.detail).toMatchObject({
        ruleName: 'stale-rule',
        conditionsVersion: 5,
        assignedToType: 'USER',
        assignedToId: 'ghost-user',
      });
    });

    it('still routes from a later rule whose target IS valid when an earlier rule points at an invalid one', async () => {
      const engine = new ScriptedRoutingEngine([
        { targetUserId: 'ghost-user', targetRoleId: null },
        { targetUserId: 'real-user', targetRoleId: null },
      ]);
      const directory = new InMemoryAssigneeDirectory();
      directory.allow(ORG, { type: 'USER', id: 'real-user' });
      const { routeCase } = buildUseCase(engine, [buildRule(), buildRule()], undefined, directory);

      const result = await routeCase({ kase: buildCase(), ...ROUTE });

      expect(result.assignedTo).toEqual({ type: 'USER', id: 'real-user' });
    });

    it('does not fall back to a deactivated/foreign role either: ROLE targets are validated the same way', async () => {
      const engine = new ScriptedRoutingEngine([{ targetUserId: null, targetRoleId: 'retired-role' }]);
      const directory = new InMemoryAssigneeDirectory();
      const { routeCase } = buildUseCase(engine, [buildRule()], undefined, directory);

      const result = await routeCase({ kase: buildCase(), ...ROUTE });

      expect(result.assignedTo).toBeNull();
    });
  });
});
