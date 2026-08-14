import { oid } from '../../../support/oid.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createDeactivateRoutingRuleUseCase } from '../../../../src/modules/case-management/application/DeactivateRoutingRule.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import { CaseRoutingRule } from '../../../../src/modules/case-management/domain/model/aggregates/CaseRoutingRule.js';
import { generateCaseRoutingRuleId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseRoutingRuleId.js';
import { InMemoryCaseRoutingRuleRepository } from '../../../helpers/case-management/InMemoryCaseRoutingRuleRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';

const ORG = oid('org-1');
const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-02-01T00:00:00.000Z'));

const VALID_JDM: Readonly<Record<string, unknown>> = {
  contentType: 'application/vnd.gorules.decision',
  nodes: [{ id: 'n1', type: 'inputNode' }],
  edges: [],
};

function buildRule(
  status: 'ACTIVE' | 'INACTIVE',
  overrides: { name?: string; organizationId?: string } = {},
): CaseRoutingRule {
  return CaseRoutingRule.create({
    id: generateCaseRoutingRuleId(),
    organizationId: overrides.organizationId ?? ORG,
    name: overrides.name ?? 'rule',
    conditions: VALID_JDM,
    conditionsVersion: 1,
    status,
    now: NOW,
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

describe('DeactivateRoutingRule', () => {
  it('deactivates one ACTIVE rule without affecting the sibling ACTIVE', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const first = buildRule('ACTIVE', { name: 'A' });
    const second = buildRule('ACTIVE', { name: 'B' });
    routingRules.add(first);
    routingRules.add(second);
    const auditRecorder = new InMemoryCaseManagementAuditRecorder();

    const deactivate = createDeactivateRoutingRuleUseCase({
      routingRules,
      auditRecorder,
      clock: { now: () => LATER },
    });

    const result = await deactivate({ auth: supervisorAuth(), ruleId: first.id });

    expect(result.status).toBe('INACTIVE');
    expect(result.id).toBe(first.id);
    expect(routingRules.all().find((r) => r.id === first.id)?.status).toBe('INACTIVE');
    expect(routingRules.all().find((r) => r.id === second.id)?.status).toBe('ACTIVE');
    expect(auditRecorder.all()).toEqual([
      expect.objectContaining({
        action: 'DEACTIVATE_ROUTING_RULE',
        resourceId: first.id,
      }),
    ]);
  });

  it('is idempotent when the rule is already INACTIVE', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const draft = buildRule('INACTIVE', { name: 'draft' });
    routingRules.add(draft);

    const deactivate = createDeactivateRoutingRuleUseCase({
      routingRules,
      auditRecorder: new InMemoryCaseManagementAuditRecorder(),
      clock: { now: () => LATER },
    });

    const result = await deactivate({ auth: supervisorAuth('ADMIN'), ruleId: draft.id });

    expect(result.status).toBe('INACTIVE');
    expect(result.id).toBe(draft.id);
    expect(routingRules.all()).toHaveLength(1);
    expect(routingRules.all()[0]?.status).toBe('INACTIVE');
  });

  it('rejects AUDITOR without changing statuses', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const active = buildRule('ACTIVE', { name: 'A' });
    routingRules.add(active);

    const deactivate = createDeactivateRoutingRuleUseCase({
      routingRules,
      auditRecorder: new InMemoryCaseManagementAuditRecorder(),
      clock: { now: () => LATER },
    });

    try {
      await deactivate({ auth: supervisorAuth('AUDITOR'), ruleId: active.id });
      throw new Error('expected deactivate to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('FORBIDDEN_ROLE');
    }
    expect(routingRules.all()[0]?.status).toBe('ACTIVE');
  });

  it('rejects unknown rule id', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const deactivate = createDeactivateRoutingRuleUseCase({
      routingRules,
      auditRecorder: new InMemoryCaseManagementAuditRecorder(),
      clock: { now: () => LATER },
    });

    try {
      await deactivate({ auth: supervisorAuth(), ruleId: generateCaseRoutingRuleId() });
      throw new Error('expected deactivate to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('ROUTING_RULE_NOT_FOUND');
    }
  });

  it('rejects cross-tenant deactivate', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const other = buildRule('ACTIVE', { organizationId: oid('org-other'), name: 'other' });
    routingRules.add(other);

    const deactivate = createDeactivateRoutingRuleUseCase({
      routingRules,
      auditRecorder: new InMemoryCaseManagementAuditRecorder(),
      clock: { now: () => LATER },
    });

    try {
      await deactivate({ auth: supervisorAuth(), ruleId: other.id });
      throw new Error('expected deactivate to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
    expect(routingRules.all()[0]?.status).toBe('ACTIVE');
  });
});
