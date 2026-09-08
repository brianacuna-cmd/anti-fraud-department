import { oid } from '../../../support/oid.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createCreateRoutingRuleUseCase } from '../../../../src/modules/case-management/application/CreateRoutingRule.js';
import {
  createCreatePriorityAssignmentRuleUseCase,
  buildPriorityAssignmentJdm,
} from '../../../../src/modules/case-management/application/CreatePriorityAssignmentRule.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import { CaseRoutingRule } from '../../../../src/modules/case-management/domain/model/aggregates/CaseRoutingRule.js';
import { generateCaseRoutingRuleId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseRoutingRuleId.js';
import { createAssignedTo } from '../../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';
import { InMemoryCaseRoutingRuleRepository } from '../../../helpers/case-management/InMemoryCaseRoutingRuleRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';

const ORG = oid('org-1');
const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function supervisorAuth() {
  return createAuthContext({
    userId: oid('supervisor-1'),
    organizationId: ORG,
    roleId: 'SUPERVISOR',
    ipAddress: '10.0.0.1',
  });
}

function build() {
  const routingRules = new InMemoryCaseRoutingRuleRepository();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const createRoutingRule = createCreateRoutingRuleUseCase({
    routingRules,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: { now: () => NOW },
    generateCaseRoutingRuleId,
  });
  const createPriorityAssignmentRule = createCreatePriorityAssignmentRuleUseCase({ createRoutingRule });
  return { createPriorityAssignmentRule, routingRules };
}

describe('buildPriorityAssignmentJdm — forma del grafo', () => {
  it('genera una fila por mapping y dos columnas de salida, con hitPolicy first', () => {
    const graph = buildPriorityAssignmentJdm([
      { priority: 'CRITICAL', target: createAssignedTo('ROLE', 'SUPERVISOR') },
      { priority: 'HIGH', target: createAssignedTo('USER', oid('analyst-1')) },
    ]) as {
      nodes: { id: string; type: string; content?: { rules: unknown[] } }[];
    };

    const table = graph.nodes.find((n) => n.type === 'decisionTableNode');
    expect(table?.content?.rules).toHaveLength(2);
    expect(table?.content).toMatchObject({ hitPolicy: 'first' });
  });

  it('escapa comillas en el id del target para no romper la expresión ZEN', () => {
    const graph = buildPriorityAssignmentJdm([
      { priority: 'LOW', target: createAssignedTo('ROLE', 'weird"role') },
    ]) as { nodes: { type: string; content?: { rules: { o2: string }[] } }[] };

    const table = graph.nodes.find((n) => n.type === 'decisionTableNode');
    expect(table?.content?.rules[0]?.o2).toBe('"weird\\"role"');
  });
});

describe('createCreatePriorityAssignmentRuleUseCase', () => {
  it('crea una regla INACTIVE cuyo target de nivel-regla queda null (evita el fallback de RouteCase)', async () => {
    const { createPriorityAssignmentRule, routingRules } = build();

    const rule = await createPriorityAssignmentRule({
      auth: supervisorAuth(),
      name: 'priority-routing',
      mappings: [
        { priority: 'CRITICAL', target: { type: 'ROLE', id: 'SUPERVISOR' } },
        { priority: 'HIGH', target: { type: 'ROLE', id: 'ANALYST' } },
      ],
    });

    expect(rule.status).toBe('INACTIVE');
    expect(rule.targetRoleId).toBeNull();
    expect(rule.targetUserId).toBeNull();
    expect(routingRules.all()).toHaveLength(1);
  });

  it('inherits create append: executionOrder is max+1 of the org catalog', async () => {
    const { createPriorityAssignmentRule, routingRules } = build();
    routingRules.add(
      CaseRoutingRule.create({
        id: generateCaseRoutingRuleId(),
        organizationId: ORG,
        name: 'existing',
        conditions: { contentType: 'application/vnd.gorules.decision', nodes: [{ id: 'n1', type: 'inputNode' }], edges: [] },
        conditionsVersion: 1,
        executionOrder: 2,
        now: NOW,
      }),
    );

    const rule = await createPriorityAssignmentRule({
      auth: supervisorAuth(),
      name: 'priority-routing',
      mappings: [{ priority: 'HIGH', target: { type: 'ROLE', id: 'ANALYST' } }],
    });

    expect(rule.executionOrder).toBe(3);
  });

  it('rechaza una lista de mappings vacía', async () => {
    const { createPriorityAssignmentRule } = build();

    await expect(
      createPriorityAssignmentRule({ auth: supervisorAuth(), name: 'empty', mappings: [] }),
    ).rejects.toThrow(CaseManagementError);
  });

  it('rechaza una prioridad inválida', async () => {
    const { createPriorityAssignmentRule } = build();

    await expect(
      createPriorityAssignmentRule({
        auth: supervisorAuth(),
        name: 'bad-priority',
        mappings: [{ priority: 'URGENT', target: { type: 'ROLE', id: 'SUPERVISOR' } }],
      }),
    ).rejects.toThrow(CaseManagementError);
  });
});
