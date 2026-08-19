import { createRouteCaseService } from '../../../../src/modules/case-management/application/RouteCase.js';
import { CaseRoutingRule } from '../../../../src/modules/case-management/domain/model/aggregates/CaseRoutingRule.js';
import { createCaseRoutingRuleId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseRoutingRuleId.js';
import { createAssignedTo } from '../../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import type { RoutableCase } from '../../../../src/modules/case-management/domain/services/RoutingPolicy.js';
import type { CaseRoutingRuleRepository } from '../../../../src/modules/case-management/domain/ports/CaseRoutingRuleRepository.js';
import type {
  AssigneeDirectory,
  ResolvedActor,
} from '../../../../src/modules/case-management/domain/ports/AssigneeDirectory.js';

const NOW = fromDate(new Date('2026-09-01T00:00:00.000Z'));

const kase: RoutableCase = {
  riskScore: 90,
  priority: 'CRITICAL',
  tags: ['AML'],
  customerEmail: 'cliente@finturu.com',
  stripeCustomerId: null,
  bridgeWallet: null,
};

function makeRule(assigneeId: string, order = 0) {
  return CaseRoutingRule.create({
    id: createCaseRoutingRuleId('64b7f1c2e4b0a1d2c3e4f5a6'),
    organizationId: 'org-1',
    name: 'Riesgo alto al equipo senior',
    evaluationOrder: order,
    conditions: { riskScoreMin: 80 },
    assignTo: createAssignedTo('USER', assigneeId),
    now: NOW,
  });
}

class StubRules implements CaseRoutingRuleRepository {
  constructor(private readonly rules: CaseRoutingRule[], private readonly failOnList = false) {}
  async save(): Promise<void> {}
  async findById(): Promise<CaseRoutingRule | null> {
    return null;
  }
  async listActive(): Promise<readonly CaseRoutingRule[]> {
    if (this.failOnList) throw new Error('mongo caido');
    return this.rules;
  }
  async listAll(): Promise<readonly CaseRoutingRule[]> {
    return this.rules;
  }
}

class StubDirectory implements AssigneeDirectory {
  constructor(private readonly exists: boolean, private readonly explode = false) {}
  async userExists(): Promise<boolean> {
    if (this.explode) throw new Error('directorio caido');
    return this.exists;
  }
  async roleExists(): Promise<boolean> {
    return this.exists;
  }
  async resolveActors(_org: string, ids: readonly string[]): Promise<readonly ResolvedActor[]> {
    return ids.map((id) => ({ id, kind: 'USER' as const, name: id }));
  }
}

function build(rules: CaseRoutingRule[], options: { assigneeExists?: boolean; listFails?: boolean; directoryFails?: boolean } = {}) {
  return createRouteCaseService({
    routingRules: new StubRules(rules, options.listFails ?? false),
    assigneeDirectory: new StubDirectory(options.assigneeExists ?? true, options.directoryFails ?? false),
  });
}

describe('createRouteCaseService', () => {
  it('resolves the assignee from the first matching rule', async () => {
    const routeCase = build([makeRule('analyst-senior')]);

    const result = await routeCase({ organizationId: 'org-1', kase });

    expect(result.assignedTo).toEqual({ type: 'USER', id: 'analyst-senior' });
    expect(result.ruleName).toBe('Riesgo alto al equipo senior');
    expect(result.ruleId).toBeTruthy();
  });

  it('returns no assignee when the tenant has no rules', async () => {
    const routeCase = build([]);

    await expect(routeCase({ organizationId: 'org-1', kase })).resolves.toEqual({
      assignedTo: null,
      ruleName: null,
      ruleId: null,
    });
  });

  it('returns no assignee when nothing matches', async () => {
    const routeCase = build([makeRule('analyst-senior')]);

    const lowRisk = { ...kase, riskScore: 10 };
    await expect(routeCase({ organizationId: 'org-1', kase: lowRisk })).resolves.toMatchObject({
      assignedTo: null,
    });
  });

  it('refuses an assignee that no longer exists rather than orphaning the case', async () => {
    // La regla se escribio cuando el analista existia; se dio de baja despues.
    const routeCase = build([makeRule('analista-de-baja')], { assigneeExists: false });

    const result = await routeCase({ organizationId: 'org-1', kase });

    expect(result.assignedTo).toBeNull();
  });

  it('degrades to unassigned when the rule store is unreachable', async () => {
    // Perder la deteccion de un fraude porque Mongo tuvo un mal momento seria
    // mucho peor que un caso esperando en la bandeja general.
    const routeCase = build([makeRule('analyst-senior')], { listFails: true });

    await expect(routeCase({ organizationId: 'org-1', kase })).resolves.toMatchObject({ assignedTo: null });
  });

  it('degrades to unassigned when the assignee directory is unreachable', async () => {
    const routeCase = build([makeRule('analyst-senior')], { directoryFails: true });

    await expect(routeCase({ organizationId: 'org-1', kase })).resolves.toMatchObject({ assignedTo: null });
  });

  it('never throws, whatever goes wrong', async () => {
    for (const options of [{ listFails: true }, { directoryFails: true }, { assigneeExists: false }]) {
      const routeCase = build([makeRule('x')], options);
      await expect(routeCase({ organizationId: 'org-1', kase })).resolves.toBeDefined();
    }
  });
});
