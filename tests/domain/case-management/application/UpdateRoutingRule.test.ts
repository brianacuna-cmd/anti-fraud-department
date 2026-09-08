import { oid } from '../../../support/oid.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createUpdateRoutingRuleUseCase } from '../../../../src/modules/case-management/application/UpdateRoutingRule.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import { CaseRoutingRule } from '../../../../src/modules/case-management/domain/model/aggregates/CaseRoutingRule.js';
import { generateCaseRoutingRuleId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseRoutingRuleId.js';
import { InMemoryCaseRoutingRuleRepository } from '../../../helpers/case-management/InMemoryCaseRoutingRuleRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import {
  InMemoryUnitOfWork,
  ThrowingUnitOfWork,
} from '../../../helpers/case-management/InMemoryUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import type { AuditEvent, AuditRecorder } from '../../../../src/modules/case-management/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../../../src/modules/case-management/domain/ports/UnitOfWork.js';

const ORG = oid('org-1');
const OTHER_ORG = oid('org-2');
const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-02-01T00:00:00.000Z'));

const VALID_JDM: Readonly<Record<string, unknown>> = {
  contentType: 'application/vnd.gorules.decision',
  nodes: [{ id: 'n1', type: 'inputNode' }],
  edges: [],
};

const NEXT_JDM: Readonly<Record<string, unknown>> = {
  contentType: 'application/vnd.gorules.decision',
  nodes: [{ id: 'n2', type: 'inputNode' }],
  edges: [],
};

function supervisorAuth(organizationId = ORG, roleId: string | null = 'SUPERVISOR') {
  return createAuthContext({
    userId: oid('user-1'),
    organizationId,
    roleId,
    ipAddress: '10.0.0.1',
  });
}

function buildRule(
  status: 'ACTIVE' | 'INACTIVE',
  overrides: {
    name?: string;
    conditions?: Readonly<Record<string, unknown>>;
    conditionsVersion?: number;
    organizationId?: string;
    targetRoleId?: string | null;
    targetUserId?: string | null;
  } = {},
): CaseRoutingRule {
  return CaseRoutingRule.create({
    id: generateCaseRoutingRuleId(),
    organizationId: overrides.organizationId ?? ORG,
    name: overrides.name ?? 'rule',
    conditions: overrides.conditions ?? VALID_JDM,
    conditionsVersion: overrides.conditionsVersion ?? 3,
    targetRoleId: overrides.targetRoleId ?? null,
    targetUserId: overrides.targetUserId ?? null,
    status,
    now: NOW,
  });
}

function buildUseCase(
  overrides: {
    routingRules?: InMemoryCaseRoutingRuleRepository;
    auditRecorder?: AuditRecorder;
    unitOfWork?: InMemoryUnitOfWork | ThrowingUnitOfWork;
  } = {},
) {
  const routingRules = overrides.routingRules ?? new InMemoryCaseRoutingRuleRepository();
  const auditRecorder = overrides.auditRecorder ?? new InMemoryCaseManagementAuditRecorder();
  const unitOfWork = overrides.unitOfWork ?? new InMemoryUnitOfWork();
  const update = createUpdateRoutingRuleUseCase({
    routingRules,
    auditRecorder,
    unitOfWork,
    clock: new FixedClock(LATER),
  });
  return { routingRules, auditRecorder, unitOfWork, update };
}

describe('createUpdateRoutingRuleUseCase', () => {
  it('saves name and conditions and audits UPDATE_ROUTING_RULE in the same unit of work', async () => {
    const { routingRules, auditRecorder, unitOfWork, update } = buildUseCase();
    const existing = buildRule('ACTIVE', { name: 'old', conditionsVersion: 3 });
    routingRules.add(existing);

    const updated = await update({
      auth: supervisorAuth(),
      ruleId: existing.id,
      name: 'renamed',
      conditions: NEXT_JDM,
    });

    expect(updated.name).toBe('renamed');
    expect(updated.conditions).toEqual(NEXT_JDM);
    expect(updated.conditionsVersion).toBe(4);
    expect(updated.status).toBe('ACTIVE');
    expect(updated.updatedAt).toBe(LATER);
    expect(unitOfWork).toBeInstanceOf(InMemoryUnitOfWork);
    expect((unitOfWork as InMemoryUnitOfWork).transactionCount).toBe(1);
    expect((auditRecorder as InMemoryCaseManagementAuditRecorder).all()).toEqual([
      expect.objectContaining({
        action: 'UPDATE_ROUTING_RULE',
        resource: 'rule',
        resourceId: existing.id,
      }),
    ]);
  });

  it('patches an INACTIVE rule without changing status', async () => {
    const { routingRules, update } = buildUseCase();
    const existing = buildRule('INACTIVE', { name: 'draft' });
    routingRules.add(existing);

    const updated = await update({
      auth: supervisorAuth(),
      ruleId: existing.id,
      name: 'draft-renamed',
      targetUserId: 'user-9',
    });

    expect(updated.status).toBe('INACTIVE');
    expect(updated.name).toBe('draft-renamed');
    expect(updated.targetUserId).toBe('user-9');
    expect(updated.conditionsVersion).toBe(3);
  });

  it('is silent on an identical body: no save, no audit, no updatedAt bump', async () => {
    const { routingRules, auditRecorder, update } = buildUseCase();
    const existing = buildRule('ACTIVE', {
      name: 'same',
      conditions: VALID_JDM,
      conditionsVersion: 3,
      targetRoleId: 'role-1',
      targetUserId: null,
    });
    routingRules.add(existing);

    const result = await update({
      auth: supervisorAuth(),
      ruleId: existing.id,
      name: 'same',
      conditions: VALID_JDM,
      targetRoleId: 'role-1',
      targetUserId: null,
    });

    expect(result.updatedAt).toBe(NOW);
    expect(result.conditionsVersion).toBe(3);
    expect(routingRules.all()[0]?.updatedAt).toBe(NOW);
    expect((auditRecorder as InMemoryCaseManagementAuditRecorder).all()).toHaveLength(0);
  });

  it('does not bump conditionsVersion when only name changes', async () => {
    const { routingRules, update } = buildUseCase();
    const existing = buildRule('ACTIVE', { name: 'old', conditionsVersion: 3 });
    routingRules.add(existing);

    const updated = await update({
      auth: supervisorAuth(),
      ruleId: existing.id,
      name: 'renamed',
    });

    expect(updated.conditionsVersion).toBe(3);
    expect(updated.name).toBe('renamed');
    expect(updated.updatedAt).toBe(LATER);
  });

  it('rejects unknown rule id without auditing', async () => {
    const { auditRecorder, update } = buildUseCase();

    try {
      await update({ auth: supervisorAuth(), ruleId: generateCaseRoutingRuleId(), name: 'x' });
      throw new Error('expected update to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('ROUTING_RULE_NOT_FOUND');
    }
    expect((auditRecorder as InMemoryCaseManagementAuditRecorder).all()).toHaveLength(0);
  });

  it('rejects cross-tenant update with FORBIDDEN_CROSS_TENANT and leaves the rule unchanged', async () => {
    const { routingRules, auditRecorder, update } = buildUseCase();
    const other = buildRule('ACTIVE', { organizationId: OTHER_ORG, name: 'other' });
    routingRules.add(other);

    try {
      await update({ auth: supervisorAuth(), ruleId: other.id, name: 'hijacked' });
      throw new Error('expected update to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
    expect(routingRules.all()[0]?.name).toBe('other');
    expect((auditRecorder as InMemoryCaseManagementAuditRecorder).all()).toHaveLength(0);
  });

  it('rejects ANALYST without saving or auditing', async () => {
    const { routingRules, auditRecorder, update } = buildUseCase();
    const existing = buildRule('ACTIVE', { name: 'old' });
    routingRules.add(existing);

    try {
      await update({
        auth: supervisorAuth(ORG, 'ANALYST'),
        ruleId: existing.id,
        name: 'hijacked',
      });
      throw new Error('expected update to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('FORBIDDEN_ROLE');
    }
    expect(routingRules.all()[0]?.name).toBe('old');
    expect((auditRecorder as InMemoryCaseManagementAuditRecorder).all()).toHaveLength(0);
  });

  it('commits neither rule change nor audit when the transaction aborts', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const existing = buildRule('ACTIVE', { name: 'old' });
    routingRules.add(existing);
    const auditRecorder = new InMemoryCaseManagementAuditRecorder();
    const { update } = buildUseCase({
      routingRules,
      auditRecorder,
      unitOfWork: new ThrowingUnitOfWork(),
    });

    await expect(
      update({ auth: supervisorAuth(), ruleId: existing.id, name: 'renamed' }),
    ).rejects.toThrow('simulated transaction abort');

    expect(routingRules.all()[0]?.name).toBe('old');
    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('threads the same transaction handle into findById, save, and auditRecorder.record', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const existing = buildRule('ACTIVE', { name: 'old' });
    routingRules.add(existing);
    const seenTx: Array<Transaction | undefined> = [];
    const originalFind = routingRules.findById.bind(routingRules);
    routingRules.findById = async (id, tx) => {
      seenTx.push(tx);
      return originalFind(id, tx);
    };
    const originalSave = routingRules.save.bind(routingRules);
    routingRules.save = async (rule, tx) => {
      seenTx.push(tx);
      return originalSave(rule, tx);
    };
    const auditRecorder: AuditRecorder = {
      record: async (event: AuditEvent, tx?: Transaction) => {
        seenTx.push(tx);
        void event;
      },
    };
    const { update } = buildUseCase({ routingRules, auditRecorder });

    await update({ auth: supervisorAuth(), ruleId: existing.id, name: 'renamed' });

    expect(seenTx).toHaveLength(3);
    expect(seenTx[0]).toBeDefined();
    expect(seenTx[0]).toBe(seenTx[1]);
    expect(seenTx[1]).toBe(seenTx[2]);
  });
});
