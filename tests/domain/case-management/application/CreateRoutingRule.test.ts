import { oid } from '../../../support/oid.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createCreateRoutingRuleUseCase } from '../../../../src/modules/case-management/application/CreateRoutingRule.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import { generateCaseRoutingRuleId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseRoutingRuleId.js';
import { InMemoryCaseRoutingRuleRepository } from '../../../helpers/case-management/InMemoryCaseRoutingRuleRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';

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
      clock: { now: () => NOW },
      generateCaseRoutingRuleId,
    });

    const created = await create({
      auth: supervisorAuth({ roleId: 'ADMIN' }),
      name: 'draft-b',
      conditions: VALID_JDM,
    });

    expect(created.conditionsVersion).toBe(1);
    expect(created.status).toBe('INACTIVE');
  });

  it('rejects ANALYST without persisting', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const create = createCreateRoutingRuleUseCase({
      routingRules,
      auditRecorder: new InMemoryCaseManagementAuditRecorder(),
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
});
