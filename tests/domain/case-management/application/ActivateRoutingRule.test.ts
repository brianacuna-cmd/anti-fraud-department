import { oid } from '../../../support/oid.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createActivateRoutingRuleUseCase } from '../../../../src/modules/case-management/application/ActivateRoutingRule.js';
import { createRouteCaseUseCase } from '../../../../src/modules/case-management/application/RouteCase.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { CaseRoutingRule } from '../../../../src/modules/case-management/domain/model/aggregates/CaseRoutingRule.js';
import { generateCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { generateCaseRoutingRuleId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseRoutingRuleId.js';
import { createCasePriority } from '../../../../src/modules/case-management/domain/model/value-objects/CasePriority.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import type {
  CaseRoutingContext,
  RoutingEngine,
  RoutingEvaluation,
} from '../../../../src/modules/case-management/domain/ports/RoutingEngine.js';
import { InMemoryCaseRoutingRuleRepository } from '../../../helpers/case-management/InMemoryCaseRoutingRuleRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { FixedClock } from '../../../helpers/FixedClock.js';

const ORG = oid('org-1');
const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-02-01T00:00:00.000Z'));
const EARLIER = fromDate(new Date('2025-12-01T00:00:00.000Z'));

const VALID_JDM: Readonly<Record<string, unknown>> = {
  contentType: 'application/vnd.gorules.decision',
  nodes: [{ id: 'n1', type: 'inputNode' }],
  edges: [],
};

function buildRule(
  status: 'ACTIVE' | 'INACTIVE',
  overrides: { name?: string; now?: typeof NOW; organizationId?: string } = {},
): CaseRoutingRule {
  return CaseRoutingRule.create({
    id: generateCaseRoutingRuleId(),
    organizationId: overrides.organizationId ?? ORG,
    name: overrides.name ?? 'rule',
    conditions: VALID_JDM,
    conditionsVersion: 1,
    status,
    now: overrides.now ?? NOW,
  });
}

function supervisorAuth(roleId: string | null = 'SUPERVISOR') {
  return createAuthContext({
    userId: oid('user-1'),
    organizationId: ORG,
    roleId,
    ipAddress: '10.0.0.1',
  });
}

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

describe('ActivateRoutingRule', () => {
  it('activates a draft without deactivating sibling ACTIVE rules (non-exclusive)', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const active = buildRule('ACTIVE', { name: 'A' });
    const draft = buildRule('INACTIVE', { name: 'B' });
    routingRules.add(active);
    routingRules.add(draft);
    const auditRecorder = new InMemoryCaseManagementAuditRecorder();

    const activate = createActivateRoutingRuleUseCase({
      routingRules,
      auditRecorder,
      clock: { now: () => LATER },
    });

    const result = await activate({ auth: supervisorAuth(), ruleId: draft.id });

    expect(result.status).toBe('ACTIVE');
    expect(result.id).toBe(draft.id);
    expect(routingRules.all().find((r) => r.id === active.id)?.status).toBe('ACTIVE');
    expect(routingRules.all().find((r) => r.id === draft.id)?.status).toBe('ACTIVE');
    expect(routingRules.all().filter((r) => r.status === 'ACTIVE')).toHaveLength(2);
    expect(auditRecorder.all()).toEqual([
      expect.objectContaining({
        action: 'ACTIVATE_ROUTING_RULE',
        resourceId: draft.id,
      }),
    ]);
  });

  it('allows two drafts to become ACTIVE and coexist after sequential activates', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const draftA = buildRule('INACTIVE', { name: 'A' });
    const draftB = buildRule('INACTIVE', { name: 'B' });
    routingRules.add(draftA);
    routingRules.add(draftB);

    const activate = createActivateRoutingRuleUseCase({
      routingRules,
      auditRecorder: new InMemoryCaseManagementAuditRecorder(),
      clock: { now: () => LATER },
    });

    await activate({ auth: supervisorAuth('ADMIN'), ruleId: draftA.id });
    await activate({ auth: supervisorAuth('ADMIN'), ruleId: draftB.id });

    const statuses = routingRules.all().map((r) => ({ id: r.id, status: r.status }));
    expect(statuses).toEqual(
      expect.arrayContaining([
        { id: draftA.id, status: 'ACTIVE' },
        { id: draftB.id, status: 'ACTIVE' },
      ]),
    );
    expect(statuses.filter((s) => s.status === 'ACTIVE')).toHaveLength(2);
  });

  it('rejects ANALYST without changing statuses', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const active = buildRule('ACTIVE', { name: 'A' });
    const draft = buildRule('INACTIVE', { name: 'B' });
    routingRules.add(active);
    routingRules.add(draft);

    const activate = createActivateRoutingRuleUseCase({
      routingRules,
      auditRecorder: new InMemoryCaseManagementAuditRecorder(),
      clock: { now: () => LATER },
    });

    try {
      await activate({ auth: supervisorAuth('ANALYST'), ruleId: draft.id });
      throw new Error('expected activate to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('FORBIDDEN_ROLE');
    }
    expect(routingRules.all().find((r) => r.id === active.id)?.status).toBe('ACTIVE');
    expect(routingRules.all().find((r) => r.id === draft.id)?.status).toBe('INACTIVE');
  });

  it('rejects unknown rule id', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const activate = createActivateRoutingRuleUseCase({
      routingRules,
      auditRecorder: new InMemoryCaseManagementAuditRecorder(),
      clock: { now: () => LATER },
    });

    try {
      await activate({ auth: supervisorAuth(), ruleId: generateCaseRoutingRuleId() });
      throw new Error('expected activate to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('ROUTING_RULE_NOT_FOUND');
    }
  });

  it('rejects cross-tenant activate', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const otherOrgDraft = buildRule('INACTIVE', { organizationId: oid('org-other'), name: 'other' });
    routingRules.add(otherOrgDraft);

    const activate = createActivateRoutingRuleUseCase({
      routingRules,
      auditRecorder: new InMemoryCaseManagementAuditRecorder(),
      clock: { now: () => LATER },
    });

    try {
      await activate({ auth: supervisorAuth(), ruleId: otherOrgDraft.id });
      throw new Error('expected activate to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
    expect(routingRules.all()[0]?.status).toBe('INACTIVE');
  });

  it('keeps RouteCase first-match-by-createdAt after two ACTIVE coexist', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const older = buildRule('INACTIVE', { name: 'older', now: EARLIER });
    const newer = buildRule('INACTIVE', { name: 'newer', now: NOW });
    routingRules.add(newer);
    routingRules.add(older);

    const activate = createActivateRoutingRuleUseCase({
      routingRules,
      auditRecorder: new InMemoryCaseManagementAuditRecorder(),
      clock: { now: () => LATER },
    });
    await activate({ auth: supervisorAuth(), ruleId: newer.id });
    await activate({ auth: supervisorAuth(), ruleId: older.id });

    const engine = new ScriptedRoutingEngine([
      { targetUserId: 'user-older', targetRoleId: null },
      { targetUserId: 'user-newer', targetRoleId: null },
    ]);
    const cases = new InMemoryCaseRepository();
    const fraudConfig = new InMemoryOrganizationFraudConfigRepository();
    const routeCase = createRouteCaseUseCase({
      cases,
      routingRules,
      routingEngine: engine,
      timelineRecorder: new InMemoryTimelineRecorder(),
      auditRecorder: new InMemoryCaseManagementAuditRecorder(),
      fraudConfig,
      clock: new FixedClock(LATER),
      generateTimelineEventId,
    });
    const kase = Case.create({
      id: generateCaseId(),
      organizationId: ORG,
      customerId: 'customer-1',
      riskScore: createRiskScore(90),
      priority: createCasePriority('HIGH'),
      tags: ['fraud'],
      now: NOW,
    });

    const result = await routeCase({
      kase,
      tx: undefined as never,
      createdBy: null,
      actorType: 'USER',
      ipAddress: null,
    });

    expect(result.assignedTo).toEqual({ type: 'USER', id: 'user-older' });
    expect(engine.contexts).toHaveLength(1);
  });
});
