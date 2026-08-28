import { oid } from '../../../support/oid.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createCreateRoutingRuleUseCase } from '../../../../src/modules/case-management/application/CreateRoutingRule.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import { CaseRoutingRule } from '../../../../src/modules/case-management/domain/model/aggregates/CaseRoutingRule.js';
import { generateCaseRoutingRuleId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseRoutingRuleId.js';
import { InMemoryCaseRoutingRuleRepository } from '../../../helpers/case-management/InMemoryCaseRoutingRuleRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import type { AuditEvent, AuditRecorder } from '../../../../src/modules/case-management/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../../../src/modules/case-management/domain/ports/UnitOfWork.js';

const ORG = oid('org-1');
const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

const VALID_JDM: Readonly<Record<string, unknown>> = {
  contentType: 'application/vnd.gorules.decision',
  nodes: [{ id: 'n1', type: 'inputNode' }],
  edges: [],
};

function supervisorAuth(overrides: { roleId?: string | null } = {}) {
  return createAuthContext({
    userId: oid('user-1'),
    organizationId: ORG,
    roleId: overrides.roleId === undefined ? 'SUPERVISOR' : overrides.roleId,
    ipAddress: '10.0.0.1',
  });
}

describe('CreateRoutingRule', () => {
  it('persists an INACTIVE draft and records CREATE_ROUTING_RULE audit', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const auditRecorder = new InMemoryCaseManagementAuditRecorder();
    const ruleId = generateCaseRoutingRuleId();
    const create = createCreateRoutingRuleUseCase({
      routingRules,
      auditRecorder,
      unitOfWork: new PassthroughUnitOfWork(),
      clock: { now: () => NOW },
      generateCaseRoutingRuleId: () => ruleId,
    });

    const created = await create({
      auth: supervisorAuth(),
      name: 'draft-a',
      conditions: VALID_JDM,
      conditionsVersion: 3,
      targetUserId: 'user-auto',
      targetRoleId: null,
    });

    expect(created.id).toBe(ruleId);
    expect(created.status).toBe('INACTIVE');
    expect(created.name).toBe('draft-a');
    expect(created.conditionsVersion).toBe(3);
    expect(created.targetUserId).toBe('user-auto');
    expect(created.organizationId).toBe(ORG);
    expect(routingRules.all()).toHaveLength(1);
    expect(routingRules.all()[0]?.status).toBe('INACTIVE');
    expect(auditRecorder.all()).toEqual([
      expect.objectContaining({
        action: 'CREATE_ROUTING_RULE',
        resource: 'rule',
        resourceId: ruleId,
        organizationId: ORG,
      }),
    ]);
  });

  it('defaults conditionsVersion to 1 when omitted', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const create = createCreateRoutingRuleUseCase({
      routingRules,
      auditRecorder: new InMemoryCaseManagementAuditRecorder(),
      unitOfWork: new PassthroughUnitOfWork(),
      clock: { now: () => NOW },
      generateCaseRoutingRuleId,
    });

    const created = await create({
      auth: supervisorAuth(),
      name: 'draft-b',
      conditions: VALID_JDM,
    });

    expect(created.conditionsVersion).toBe(1);
    expect(created.status).toBe('INACTIVE');
  });

  it('appends executionOrder 0 when the organization catalog is empty', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const create = createCreateRoutingRuleUseCase({
      routingRules,
      auditRecorder: new InMemoryCaseManagementAuditRecorder(),
      unitOfWork: new PassthroughUnitOfWork(),
      clock: { now: () => NOW },
      generateCaseRoutingRuleId,
    });

    const created = await create({ auth: supervisorAuth(), name: 'first', conditions: VALID_JDM });

    expect(created.executionOrder).toBe(0);
  });

  it('appends max(executionOrder)+1 after existing org rules, including a gap', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    routingRules.add(
      CaseRoutingRule.create({
        id: generateCaseRoutingRuleId(),
        organizationId: ORG,
        name: 'existing-low',
        conditions: VALID_JDM,
        conditionsVersion: 1,
        executionOrder: 0,
        now: NOW,
      }),
    );
    routingRules.add(
      CaseRoutingRule.create({
        id: generateCaseRoutingRuleId(),
        organizationId: ORG,
        name: 'existing-high',
        conditions: VALID_JDM,
        conditionsVersion: 1,
        executionOrder: 5,
        now: NOW,
      }),
    );
    routingRules.add(
      CaseRoutingRule.create({
        id: generateCaseRoutingRuleId(),
        organizationId: oid('org-2'),
        name: 'other-org',
        conditions: VALID_JDM,
        conditionsVersion: 1,
        executionOrder: 99,
        now: NOW,
      }),
    );
    const create = createCreateRoutingRuleUseCase({
      routingRules,
      auditRecorder: new InMemoryCaseManagementAuditRecorder(),
      unitOfWork: new PassthroughUnitOfWork(),
      clock: { now: () => NOW },
      generateCaseRoutingRuleId,
    });

    const created = await create({ auth: supervisorAuth(), name: 'appended', conditions: VALID_JDM });

    expect(created.executionOrder).toBe(6);
  });

  it('lists the catalog inside the same transaction as save', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const seenTx: Array<Transaction | undefined> = [];
    const originalList = routingRules.listByOrganization.bind(routingRules);
    routingRules.listByOrganization = async (organizationId, tx) => {
      seenTx.push(tx);
      return originalList(organizationId, tx);
    };
    const originalSave = routingRules.save.bind(routingRules);
    routingRules.save = async (rule, tx) => {
      seenTx.push(tx);
      return originalSave(rule, tx);
    };
    const create = createCreateRoutingRuleUseCase({
      routingRules,
      auditRecorder: new InMemoryCaseManagementAuditRecorder(),
      unitOfWork: new PassthroughUnitOfWork(),
      clock: { now: () => NOW },
      generateCaseRoutingRuleId,
    });

    await create({ auth: supervisorAuth(), name: 'tx-list', conditions: VALID_JDM });

    expect(seenTx).toHaveLength(2);
    expect(seenTx[0]).toBeDefined();
    expect(seenTx[0]).toBe(seenTx[1]);
  });

  it('rejects ANALYST without persisting', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const create = createCreateRoutingRuleUseCase({
      routingRules,
      auditRecorder: new InMemoryCaseManagementAuditRecorder(),
      unitOfWork: new PassthroughUnitOfWork(),
      clock: { now: () => NOW },
      generateCaseRoutingRuleId,
    });

    try {
      await create({
        auth: supervisorAuth({ roleId: 'ANALYST' }),
        name: 'draft-c',
        conditions: VALID_JDM,
      });
      throw new Error('expected create to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('FORBIDDEN_ROLE');
    }
    expect(routingRules.all()).toHaveLength(0);
  });

  it('rejects AUDITOR without persisting', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const create = createCreateRoutingRuleUseCase({
      routingRules,
      auditRecorder: new InMemoryCaseManagementAuditRecorder(),
      unitOfWork: new PassthroughUnitOfWork(),
      clock: { now: () => NOW },
      generateCaseRoutingRuleId,
    });

    try {
      await create({
        auth: supervisorAuth({ roleId: 'AUDITOR' }),
        name: 'draft-d',
        conditions: VALID_JDM,
      });
      throw new Error('expected create to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('FORBIDDEN_ROLE');
    }
    expect(routingRules.all()).toHaveLength(0);
  });

  it('threads the same transaction handle into both save() and auditRecorder.record() (REQ-E1.1)', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const seenTx: Array<Transaction | undefined> = [];
    const savedRules: string[] = [];
    const auditRecorder: AuditRecorder = {
      record: async (event: AuditEvent, tx?: Transaction) => {
        seenTx.push(tx);
        void event;
      },
    };
    const originalSave = routingRules.save.bind(routingRules);
    routingRules.save = async (rule, tx) => {
      savedRules.push(rule.id);
      seenTx.push(tx);
      return originalSave(rule, tx);
    };
    const create = createCreateRoutingRuleUseCase({
      routingRules,
      auditRecorder,
      unitOfWork: new PassthroughUnitOfWork(),
      clock: { now: () => NOW },
      generateCaseRoutingRuleId,
    });

    await create({ auth: supervisorAuth(), name: 'draft-tx', conditions: VALID_JDM });

    expect(savedRules).toHaveLength(1);
    expect(seenTx).toHaveLength(2);
    expect(seenTx[0]).toBeDefined();
    expect(seenTx[0]).toBe(seenTx[1]);
  });

  it('propagates audit recorder failures so the rule is not left persisted without its audit trail (REQ-E1.2)', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const failingAuditRecorder: AuditRecorder = {
      record: async () => {
        throw new Error('audit sink unavailable');
      },
    };
    const create = createCreateRoutingRuleUseCase({
      routingRules,
      auditRecorder: failingAuditRecorder,
      unitOfWork: new PassthroughUnitOfWork(),
      clock: { now: () => NOW },
      generateCaseRoutingRuleId,
    });

    await expect(
      create({ auth: supervisorAuth(), name: 'draft-fail', conditions: VALID_JDM }),
    ).rejects.toThrow('audit sink unavailable');
  });
});
