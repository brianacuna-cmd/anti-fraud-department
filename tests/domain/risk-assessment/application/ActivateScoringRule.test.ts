import { oid } from '../../../support/oid.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createActivateScoringRuleUseCase } from '../../../../src/modules/risk-assessment/application/ActivateScoringRule.js';
import { RiskScoringRule } from '../../../../src/modules/risk-assessment/domain/model/aggregates/RiskScoringRule.js';
import { generateRiskScoringRuleId } from '../../../../src/modules/risk-assessment/domain/model/value-objects/RiskScoringRuleId.js';
import { RiskAssessmentError } from '../../../../src/modules/risk-assessment/domain/errors/RiskAssessmentError.js';
import { InMemoryRiskScoringRuleRepository } from '../../../helpers/risk-assessment/InMemoryRiskScoringRuleRepository.js';
import { InMemoryRiskAssessmentAuditRecorder } from '../../../helpers/risk-assessment/InMemoryRiskAssessmentAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/risk-assessment/infrastructure/PassthroughUnitOfWork.js';

const ORG = oid('org-1');
const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-02-01T00:00:00.000Z'));

function buildRule(
  status: 'ACTIVE' | 'INACTIVE',
  overrides: { organizationId?: string; name?: string } = {},
): RiskScoringRule {
  return RiskScoringRule.create({
    id: generateRiskScoringRuleId(),
    organizationId: overrides.organizationId ?? ORG,
    name: overrides.name ?? 'rule',
    conditions: {
      contentType: 'application/vnd.gorules.decision',
      nodes: [{ id: 'n1', type: 'inputNode' }],
      edges: [],
    },
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

describe('ActivateScoringRule', () => {
  it('swaps ACTIVE A to INACTIVE and draft B to ACTIVE in one UoW', async () => {
    const scoringRules = new InMemoryRiskScoringRuleRepository();
    const active = buildRule('ACTIVE', { name: 'A' });
    const draft = buildRule('INACTIVE', { name: 'B' });
    scoringRules.add(active);
    scoringRules.add(draft);
    const auditRecorder = new InMemoryRiskAssessmentAuditRecorder();

    const activate = createActivateScoringRuleUseCase({
      scoringRules,
      unitOfWork: new PassthroughUnitOfWork(),
      auditRecorder,
      clock: { now: () => LATER },
    });

    const result = await activate({ auth: supervisorAuth(), ruleId: draft.id });

    expect(result.status).toBe('ACTIVE');
    expect(result.id).toBe(draft.id);
    expect(scoringRules.all().find((r) => r.id === active.id)?.status).toBe('INACTIVE');
    expect(scoringRules.all().find((r) => r.id === draft.id)?.status).toBe('ACTIVE');
    expect(auditRecorder.all()).toEqual([
      expect.objectContaining({
        action: 'ACTIVATE_SCORING_RULE',
        resourceId: draft.id,
      }),
    ]);
  });

  it('activates a draft when no current ACTIVE exists', async () => {
    const scoringRules = new InMemoryRiskScoringRuleRepository();
    const draft = buildRule('INACTIVE', { name: 'only' });
    scoringRules.add(draft);

    const activate = createActivateScoringRuleUseCase({
      scoringRules,
      unitOfWork: new PassthroughUnitOfWork(),
      auditRecorder: new InMemoryRiskAssessmentAuditRecorder(),
      clock: { now: () => LATER },
    });

    const result = await activate({ auth: supervisorAuth('ADMIN'), ruleId: draft.id });

    expect(result.status).toBe('ACTIVE');
    expect(scoringRules.all()).toHaveLength(1);
    expect(scoringRules.all()[0]?.status).toBe('ACTIVE');
  });

  it('rejects ANALYST without changing statuses', async () => {
    const scoringRules = new InMemoryRiskScoringRuleRepository();
    const active = buildRule('ACTIVE', { name: 'A' });
    const draft = buildRule('INACTIVE', { name: 'B' });
    scoringRules.add(active);
    scoringRules.add(draft);

    const activate = createActivateScoringRuleUseCase({
      scoringRules,
      unitOfWork: new PassthroughUnitOfWork(),
      auditRecorder: new InMemoryRiskAssessmentAuditRecorder(),
      clock: { now: () => LATER },
    });

    try {
      await activate({ auth: supervisorAuth('ANALYST'), ruleId: draft.id });
      throw new Error('expected activate to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(RiskAssessmentError);
      expect((error as RiskAssessmentError).code).toBe('FORBIDDEN_ROLE');
    }
    expect(scoringRules.all().find((r) => r.id === active.id)?.status).toBe('ACTIVE');
    expect(scoringRules.all().find((r) => r.id === draft.id)?.status).toBe('INACTIVE');
  });

  it('rejects unknown rule id', async () => {
    const scoringRules = new InMemoryRiskScoringRuleRepository();
    const activate = createActivateScoringRuleUseCase({
      scoringRules,
      unitOfWork: new PassthroughUnitOfWork(),
      auditRecorder: new InMemoryRiskAssessmentAuditRecorder(),
      clock: { now: () => LATER },
    });

    try {
      await activate({ auth: supervisorAuth(), ruleId: generateRiskScoringRuleId() });
      throw new Error('expected activate to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(RiskAssessmentError);
      expect((error as RiskAssessmentError).code).toBe('SCORING_RULE_NOT_FOUND');
    }
  });
});
