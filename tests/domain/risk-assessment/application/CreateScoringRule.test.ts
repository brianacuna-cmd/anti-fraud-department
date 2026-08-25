import { oid } from '../../../support/oid.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createCreateScoringRuleUseCase } from '../../../../src/modules/risk-assessment/application/CreateScoringRule.js';
import { RiskAssessmentError } from '../../../../src/modules/risk-assessment/domain/errors/RiskAssessmentError.js';
import { generateRiskScoringRuleId } from '../../../../src/modules/risk-assessment/domain/model/value-objects/RiskScoringRuleId.js';
import { InMemoryRiskScoringRuleRepository } from '../../../helpers/risk-assessment/InMemoryRiskScoringRuleRepository.js';
import { InMemoryRiskAssessmentAuditRecorder } from '../../../helpers/risk-assessment/InMemoryRiskAssessmentAuditRecorder.js';

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

describe('CreateScoringRule', () => {
  it('persists an INACTIVE draft and records CREATE_SCORING_RULE audit', async () => {
    const scoringRules = new InMemoryRiskScoringRuleRepository();
    const auditRecorder = new InMemoryRiskAssessmentAuditRecorder();
    const ruleId = generateRiskScoringRuleId();
    const create = createCreateScoringRuleUseCase({
      scoringRules,
      auditRecorder,
      clock: { now: () => NOW },
      generateRiskScoringRuleId: () => ruleId,
    });

    const created = await create({
      auth: supervisorAuth(),
      name: 'draft-a',
      conditions: VALID_JDM,
      conditionsVersion: 3,
    });

    expect(created.id).toBe(ruleId);
    expect(created.status).toBe('INACTIVE');
    expect(created.name).toBe('draft-a');
    expect(created.conditionsVersion).toBe(3);
    expect(scoringRules.all()).toHaveLength(1);
    expect(scoringRules.all()[0]?.status).toBe('INACTIVE');
    expect(auditRecorder.all()).toEqual([
      expect.objectContaining({
        action: 'CREATE_SCORING_RULE',
        resource: 'rule',
        resourceId: ruleId,
        organizationId: ORG,
      }),
    ]);
  });

  it('defaults conditionsVersion to 1 when omitted', async () => {
    const scoringRules = new InMemoryRiskScoringRuleRepository();
    const create = createCreateScoringRuleUseCase({
      scoringRules,
      auditRecorder: new InMemoryRiskAssessmentAuditRecorder(),
      clock: { now: () => NOW },
      generateRiskScoringRuleId,
    });

    const created = await create({
      auth: supervisorAuth(),
      name: 'draft-b',
      conditions: VALID_JDM,
    });

    expect(created.conditionsVersion).toBe(1);
  });

  it('rejects ANALYST without persisting', async () => {
    const scoringRules = new InMemoryRiskScoringRuleRepository();
    const create = createCreateScoringRuleUseCase({
      scoringRules,
      auditRecorder: new InMemoryRiskAssessmentAuditRecorder(),
      clock: { now: () => NOW },
      generateRiskScoringRuleId,
    });

    try {
      await create({
        auth: supervisorAuth({ roleId: 'ANALYST' }),
        name: 'draft-c',
        conditions: VALID_JDM,
      });
      throw new Error('expected create to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(RiskAssessmentError);
      expect((error as RiskAssessmentError).code).toBe('FORBIDDEN_ROLE');
    }
    expect(scoringRules.all()).toHaveLength(0);
  });
});
