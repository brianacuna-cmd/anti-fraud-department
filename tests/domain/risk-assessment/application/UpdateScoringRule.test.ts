import { oid } from '../../../support/oid.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createUpdateScoringRuleUseCase } from '../../../../src/modules/risk-assessment/application/UpdateScoringRule.js';
import { RiskAssessmentError } from '../../../../src/modules/risk-assessment/domain/errors/RiskAssessmentError.js';
import { RiskScoringRule } from '../../../../src/modules/risk-assessment/domain/model/aggregates/RiskScoringRule.js';
import { generateRiskScoringRuleId } from '../../../../src/modules/risk-assessment/domain/model/value-objects/RiskScoringRuleId.js';
import { InMemoryRiskScoringRuleRepository } from '../../../helpers/risk-assessment/InMemoryRiskScoringRuleRepository.js';
import { InMemoryRiskAssessmentAuditRecorder } from '../../../helpers/risk-assessment/InMemoryRiskAssessmentAuditRecorder.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import type { AuditEvent, AuditRecorder } from '../../../../src/modules/risk-assessment/domain/ports/AuditRecorder.js';
import type { Transaction, UnitOfWork } from '../../../../src/modules/risk-assessment/domain/ports/UnitOfWork.js';

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

class InMemoryUnitOfWork implements UnitOfWork {
  private readonly fakeTransaction = {} as Transaction;
  transactionCount = 0;

  async withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    return work(this.fakeTransaction);
  }
}

class ThrowingUnitOfWork implements UnitOfWork {
  async withTransaction<T>(_work: (tx: Transaction) => Promise<T>): Promise<T> {
    throw new Error('simulated transaction abort');
  }
}

function supervisorAuth(organizationId = ORG, roleId: string | null = 'SUPERVISOR') {
  return createAuthContext({
    userId: oid('user-1'),
    organizationId,
    roleId,
    ipAddress: '10.0.0.1',
  });
}

function organizationAuth(organizationId = ORG) {
  return createAuthContext({
    userId: organizationId,
    organizationId,
    actorType: 'ORGANIZATION',
    roleId: null,
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
  } = {},
): RiskScoringRule {
  return RiskScoringRule.create({
    id: generateRiskScoringRuleId(),
    organizationId: overrides.organizationId ?? ORG,
    name: overrides.name ?? 'rule',
    conditions: overrides.conditions ?? VALID_JDM,
    conditionsVersion: overrides.conditionsVersion ?? 3,
    status,
    now: NOW,
  });
}

function buildUseCase(
  overrides: {
    scoringRules?: InMemoryRiskScoringRuleRepository;
    auditRecorder?: AuditRecorder;
    unitOfWork?: InMemoryUnitOfWork | ThrowingUnitOfWork;
  } = {},
) {
  const scoringRules = overrides.scoringRules ?? new InMemoryRiskScoringRuleRepository();
  const auditRecorder = overrides.auditRecorder ?? new InMemoryRiskAssessmentAuditRecorder();
  const unitOfWork = overrides.unitOfWork ?? new InMemoryUnitOfWork();
  const update = createUpdateScoringRuleUseCase({
    scoringRules,
    auditRecorder,
    unitOfWork,
    clock: new FixedClock(LATER),
  });
  return { scoringRules, auditRecorder, unitOfWork, update };
}

describe('createUpdateScoringRuleUseCase', () => {
  it('saves name and conditions and audits UPDATE_SCORING_RULE in the same unit of work', async () => {
    const { scoringRules, auditRecorder, unitOfWork, update } = buildUseCase();
    const existing = buildRule('ACTIVE', { name: 'old', conditionsVersion: 3 });
    scoringRules.add(existing);

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
    expect((auditRecorder as InMemoryRiskAssessmentAuditRecorder).all()).toEqual([
      expect.objectContaining({
        action: 'UPDATE_SCORING_RULE',
        resource: 'rule',
        resourceId: existing.id,
        detail: {
          name: 'renamed',
          conditionsVersion: 4,
          status: 'ACTIVE',
        },
      }),
    ]);
  });

  it('patches an INACTIVE rule without changing status', async () => {
    const { scoringRules, update } = buildUseCase();
    const existing = buildRule('INACTIVE', { name: 'draft' });
    scoringRules.add(existing);

    const updated = await update({
      auth: supervisorAuth(),
      ruleId: existing.id,
      name: 'draft-renamed',
    });

    expect(updated.status).toBe('INACTIVE');
    expect(updated.name).toBe('draft-renamed');
    expect(updated.conditionsVersion).toBe(3);
  });

  it('is silent on an identical body: no save, no audit, no updatedAt bump', async () => {
    const { scoringRules, auditRecorder, update } = buildUseCase();
    const existing = buildRule('ACTIVE', {
      name: 'same',
      conditions: VALID_JDM,
      conditionsVersion: 3,
    });
    scoringRules.add(existing);

    const result = await update({
      auth: supervisorAuth(),
      ruleId: existing.id,
      name: 'same',
      conditions: VALID_JDM,
    });

    expect(result.updatedAt).toBe(NOW);
    expect(result.conditionsVersion).toBe(3);
    expect(scoringRules.all()[0]?.updatedAt).toBe(NOW);
    expect((auditRecorder as InMemoryRiskAssessmentAuditRecorder).all()).toHaveLength(0);
  });

  it('is silent on an empty object patch: no save, no audit, no updatedAt bump', async () => {
    const { scoringRules, auditRecorder, update } = buildUseCase();
    const existing = buildRule('ACTIVE', { name: 'kept' });
    scoringRules.add(existing);

    const result = await update({
      auth: supervisorAuth(),
      ruleId: existing.id,
    });

    expect(result.name).toBe('kept');
    expect(result.updatedAt).toBe(NOW);
    expect(scoringRules.all()[0]?.updatedAt).toBe(NOW);
    expect((auditRecorder as InMemoryRiskAssessmentAuditRecorder).all()).toHaveLength(0);
  });

  it('does not bump conditionsVersion when only name changes', async () => {
    const { scoringRules, update } = buildUseCase();
    const existing = buildRule('ACTIVE', { name: 'old', conditionsVersion: 3 });
    scoringRules.add(existing);

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
      await update({ auth: supervisorAuth(), ruleId: generateRiskScoringRuleId(), name: 'x' });
      throw new Error('expected update to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(RiskAssessmentError);
      expect((error as RiskAssessmentError).code).toBe('SCORING_RULE_NOT_FOUND');
    }
    expect((auditRecorder as InMemoryRiskAssessmentAuditRecorder).all()).toHaveLength(0);
  });

  it('rejects cross-tenant update with FORBIDDEN_CROSS_TENANT and leaves the rule unchanged', async () => {
    const { scoringRules, auditRecorder, update } = buildUseCase();
    const other = buildRule('ACTIVE', { organizationId: OTHER_ORG, name: 'other' });
    scoringRules.add(other);

    try {
      await update({ auth: supervisorAuth(), ruleId: other.id, name: 'hijacked' });
      throw new Error('expected update to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(RiskAssessmentError);
      expect((error as RiskAssessmentError).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
    expect(scoringRules.all()[0]?.name).toBe('other');
    expect((auditRecorder as InMemoryRiskAssessmentAuditRecorder).all()).toHaveLength(0);
  });

  it('rejects ANALYST without saving or auditing', async () => {
    const { scoringRules, auditRecorder, update } = buildUseCase();
    const existing = buildRule('ACTIVE', { name: 'old' });
    scoringRules.add(existing);

    try {
      await update({
        auth: supervisorAuth(ORG, 'ANALYST'),
        ruleId: existing.id,
        name: 'hijacked',
      });
      throw new Error('expected update to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(RiskAssessmentError);
      expect((error as RiskAssessmentError).code).toBe('FORBIDDEN_ROLE');
    }
    expect(scoringRules.all()[0]?.name).toBe('old');
    expect((auditRecorder as InMemoryRiskAssessmentAuditRecorder).all()).toHaveLength(0);
  });

  it('allows ORGANIZATION actor to patch a same-tenant rule', async () => {
    const { scoringRules, auditRecorder, update } = buildUseCase();
    const existing = buildRule('ACTIVE', { name: 'old' });
    scoringRules.add(existing);

    const updated = await update({
      auth: organizationAuth(),
      ruleId: existing.id,
      name: 'owner-renamed',
    });

    expect(updated.name).toBe('owner-renamed');
    expect((auditRecorder as InMemoryRiskAssessmentAuditRecorder).all()).toEqual([
      expect.objectContaining({ action: 'UPDATE_SCORING_RULE' }),
    ]);
  });

  it('commits neither rule change nor audit when the transaction aborts', async () => {
    const scoringRules = new InMemoryRiskScoringRuleRepository();
    const existing = buildRule('ACTIVE', { name: 'old' });
    scoringRules.add(existing);
    const auditRecorder = new InMemoryRiskAssessmentAuditRecorder();
    const { update } = buildUseCase({
      scoringRules,
      auditRecorder,
      unitOfWork: new ThrowingUnitOfWork(),
    });

    await expect(
      update({ auth: supervisorAuth(), ruleId: existing.id, name: 'renamed' }),
    ).rejects.toThrow('simulated transaction abort');

    expect(scoringRules.all()[0]?.name).toBe('old');
    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('threads the same transaction handle into findById, save, and auditRecorder.record', async () => {
    const scoringRules = new InMemoryRiskScoringRuleRepository();
    const existing = buildRule('ACTIVE', { name: 'old' });
    scoringRules.add(existing);
    const seenTx: Array<Transaction | undefined> = [];
    const originalFind = scoringRules.findById.bind(scoringRules);
    scoringRules.findById = async (id, tx) => {
      seenTx.push(tx);
      return originalFind(id, tx);
    };
    const originalSave = scoringRules.save.bind(scoringRules);
    scoringRules.save = async (rule, tx) => {
      seenTx.push(tx);
      return originalSave(rule, tx);
    };
    const auditRecorder: AuditRecorder = {
      record: async (event: AuditEvent, tx?: Transaction) => {
        seenTx.push(tx);
        void event;
      },
    };
    const { update } = buildUseCase({ scoringRules, auditRecorder });

    await update({ auth: supervisorAuth(), ruleId: existing.id, name: 'renamed' });

    expect(seenTx).toHaveLength(3);
    expect(seenTx[0]).toBeDefined();
    expect(seenTx[0]).toBe(seenTx[1]);
    expect(seenTx[1]).toBe(seenTx[2]);
  });
});
