import { oid } from '../../../support/oid.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createReorderRoutingRulesUseCase } from '../../../../src/modules/case-management/application/ReorderRoutingRules.js';
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

function supervisorAuth(organizationId = ORG, roleId: string | null = 'SUPERVISOR') {
  return createAuthContext({
    userId: oid('user-1'),
    organizationId,
    roleId,
    ipAddress: '10.0.0.1',
  });
}

function buildRule(
  name: string,
  overrides: {
    organizationId?: string;
    executionOrder?: number;
    createdAt?: typeof NOW;
    status?: 'ACTIVE' | 'INACTIVE';
  } = {},
): CaseRoutingRule {
  return CaseRoutingRule.create({
    id: generateCaseRoutingRuleId(),
    organizationId: overrides.organizationId ?? ORG,
    name,
    conditions: VALID_JDM,
    conditionsVersion: 1,
    executionOrder: overrides.executionOrder ?? 0,
    status: overrides.status ?? 'ACTIVE',
    now: overrides.createdAt ?? NOW,
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
  const reorder = createReorderRoutingRulesUseCase({
    routingRules,
    auditRecorder,
    unitOfWork,
    clock: new FixedClock(LATER),
  });
  return { routingRules, auditRecorder, unitOfWork, reorder };
}

describe('createReorderRoutingRulesUseCase', () => {
  it('rewrites executionOrder 0..n-1 for [C,A,B] and audits REORDER_ROUTING_RULES with null resourceId', async () => {
    const { routingRules, auditRecorder, unitOfWork, reorder } = buildUseCase();
    const a = buildRule('A', { executionOrder: 0, createdAt: fromDate(new Date('2026-01-01T00:00:00.000Z')) });
    const b = buildRule('B', { executionOrder: 1, createdAt: fromDate(new Date('2026-01-02T00:00:00.000Z')) });
    const c = buildRule('C', { executionOrder: 2, createdAt: fromDate(new Date('2026-01-03T00:00:00.000Z')) });
    routingRules.add(a);
    routingRules.add(b);
    routingRules.add(c);
    const ids = [c.id, a.id, b.id];

    const result = await reorder({ auth: supervisorAuth(), ids });

    expect(result.map((rule) => rule.id)).toEqual(ids);
    expect(result.map((rule) => rule.executionOrder)).toEqual([0, 1, 2]);
    expect(result.every((rule) => rule.updatedAt === LATER)).toBe(true);
    expect(result.every((rule) => rule.conditionsVersion === 1)).toBe(true);
    const persisted = new Map(routingRules.all().map((rule) => [rule.id, rule]));
    expect(persisted.get(c.id)?.executionOrder).toBe(0);
    expect(persisted.get(a.id)?.executionOrder).toBe(1);
    expect(persisted.get(b.id)?.executionOrder).toBe(2);
    expect((unitOfWork as InMemoryUnitOfWork).transactionCount).toBe(1);
    expect((auditRecorder as InMemoryCaseManagementAuditRecorder).all()).toEqual([
      expect.objectContaining({
        action: 'REORDER_ROUTING_RULES',
        resource: 'rule',
        resourceId: null,
        organizationId: ORG,
        detail: { ids },
      }),
    ]);
  });

  it('rejects a partial id list without changing executionOrder or auditing', async () => {
    const { routingRules, auditRecorder, reorder } = buildUseCase();
    const a = buildRule('A', { executionOrder: 0 });
    const b = buildRule('B', { executionOrder: 1 });
    const c = buildRule('C', { executionOrder: 2 });
    routingRules.add(a);
    routingRules.add(b);
    routingRules.add(c);

    try {
      await reorder({ auth: supervisorAuth(), ids: [c.id, a.id] });
      throw new Error('expected reorder to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('INVARIANT_VIOLATION');
    }
    expect(routingRules.all().map((rule) => rule.executionOrder).sort()).toEqual([0, 1, 2]);
    expect(routingRules.all().every((rule) => rule.updatedAt === NOW)).toBe(true);
    expect((auditRecorder as InMemoryCaseManagementAuditRecorder).all()).toHaveLength(0);
  });

  it('rejects ANALYST without changing executionOrder', async () => {
    const { routingRules, auditRecorder, reorder } = buildUseCase();
    const a = buildRule('A');
    routingRules.add(a);

    try {
      await reorder({ auth: supervisorAuth(ORG, 'ANALYST'), ids: [a.id] });
      throw new Error('expected reorder to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('FORBIDDEN_ROLE');
    }
    expect(routingRules.all()[0]?.executionOrder).toBe(0);
    expect((auditRecorder as InMemoryCaseManagementAuditRecorder).all()).toHaveLength(0);
  });

  it('is silent on identity order: no save, no audit, no updatedAt bump', async () => {
    const { routingRules, auditRecorder, reorder } = buildUseCase();
    const a = buildRule('A', { executionOrder: 0, createdAt: fromDate(new Date('2026-01-01T00:00:00.000Z')) });
    const b = buildRule('B', { executionOrder: 1, createdAt: fromDate(new Date('2026-01-02T00:00:00.000Z')) });
    routingRules.add(a);
    routingRules.add(b);

    const result = await reorder({ auth: supervisorAuth(), ids: [a.id, b.id] });

    expect(result.map((rule) => rule.id)).toEqual([a.id, b.id]);
    expect(result.map((rule) => rule.updatedAt)).toEqual([a.updatedAt, b.updatedAt]);
    expect(routingRules.all().find((rule) => rule.id === a.id)?.updatedAt).toBe(a.updatedAt);
    expect(routingRules.all().find((rule) => rule.id === b.id)?.updatedAt).toBe(b.updatedAt);
    expect((auditRecorder as InMemoryCaseManagementAuditRecorder).all()).toHaveLength(0);
  });

  it('rejects cross-tenant ids with FORBIDDEN_CROSS_TENANT and leaves orders unchanged', async () => {
    const { routingRules, auditRecorder, reorder } = buildUseCase();
    const own = buildRule('own', { executionOrder: 0 });
    const foreign = buildRule('foreign', { organizationId: OTHER_ORG, executionOrder: 0 });
    routingRules.add(own);
    routingRules.add(foreign);

    try {
      await reorder({ auth: supervisorAuth(), ids: [foreign.id] });
      throw new Error('expected reorder to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
    expect(routingRules.all().find((rule) => rule.id === own.id)?.executionOrder).toBe(0);
    expect(routingRules.all().find((rule) => rule.id === foreign.id)?.executionOrder).toBe(0);
    expect((auditRecorder as InMemoryCaseManagementAuditRecorder).all()).toHaveLength(0);
  });

  it('commits neither order change nor audit when the transaction aborts', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const a = buildRule('A', { executionOrder: 0 });
    const b = buildRule('B', { executionOrder: 1 });
    routingRules.add(a);
    routingRules.add(b);
    const auditRecorder = new InMemoryCaseManagementAuditRecorder();
    const { reorder } = buildUseCase({
      routingRules,
      auditRecorder,
      unitOfWork: new ThrowingUnitOfWork(),
    });

    await expect(reorder({ auth: supervisorAuth(), ids: [b.id, a.id] })).rejects.toThrow(
      'simulated transaction abort',
    );

    expect(routingRules.all().find((rule) => rule.id === a.id)?.executionOrder).toBe(0);
    expect(routingRules.all().find((rule) => rule.id === b.id)?.executionOrder).toBe(1);
    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('threads the same transaction into list, save, and audit', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const a = buildRule('A', { executionOrder: 0 });
    const b = buildRule('B', { executionOrder: 1 });
    routingRules.add(a);
    routingRules.add(b);
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
    const auditRecorder: AuditRecorder = {
      record: async (event: AuditEvent, tx?: Transaction) => {
        seenTx.push(tx);
        void event;
      },
    };
    const { reorder } = buildUseCase({ routingRules, auditRecorder });

    await reorder({ auth: supervisorAuth(), ids: [b.id, a.id] });

    expect(seenTx.length).toBeGreaterThanOrEqual(4);
    expect(seenTx.every((tx) => tx === seenTx[0])).toBe(true);
    expect(seenTx[0]).toBeDefined();
  });
});
