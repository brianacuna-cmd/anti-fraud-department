import type { RiskScoringEngine } from '../../../../src/modules/risk-assessment/domain/ports/RiskScoringEngine.js';
import type { RiskScoringRuleRepository } from '../../../../src/modules/risk-assessment/domain/ports/RiskScoringRuleRepository.js';
import type { AuditRecorder, AuditEvent } from '../../../../src/modules/risk-assessment/domain/ports/AuditRecorder.js';
import type { Transaction, UnitOfWork } from '../../../../src/modules/risk-assessment/domain/ports/UnitOfWork.js';
import { RiskScoringRule } from '../../../../src/modules/risk-assessment/domain/model/aggregates/RiskScoringRule.js';
import { generateRiskScoringRuleId } from '../../../../src/modules/risk-assessment/domain/model/value-objects/RiskScoringRuleId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

describe('risk-assessment domain ports', () => {
  it('RiskScoringEngine.evaluate returns a numeric riskScore from conditions and context', async () => {
    const engine: RiskScoringEngine = {
      async evaluate(conditions, context) {
        expect(conditions).toEqual({ nodes: [{ type: 'expressionNode' }] });
        expect(context).toEqual({ amountCents: 2500 });
        expect(context).not.toHaveProperty('rawPayload');
        return { riskScore: 42 };
      },
    };

    const result = await engine.evaluate({ nodes: [{ type: 'expressionNode' }] }, { amountCents: 2500 });

    expect(result).toEqual({ riskScore: 42 });
  });

  it('RiskScoringRuleRepository.findActiveByOrganization returns ACTIVE rules', async () => {
    const rule = RiskScoringRule.create({
      id: generateRiskScoringRuleId(),
      organizationId: 'org-1',
      name: 'score-graph',
      conditions: { nodes: [] },
      conditionsVersion: 2,
      status: 'ACTIVE',
      now: NOW,
    });

    const repository: RiskScoringRuleRepository = {
      async findActiveByOrganization(organizationId) {
        expect(organizationId).toBe('org-1');
        return [rule];
      },
      async findById() {
        return null;
      },
      async listByOrganization() {
        return [];
      },
      async save() {},
    };

    const found = await repository.findActiveByOrganization('org-1');

    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe('score-graph');
    expect(found[0]?.conditionsVersion).toBe(2);
  });

  it('AuditRecorder.record accepts CALCULATE_RISK_SCORE and SCORING_RULE_EVALUATION_FAILED', async () => {
    const recorded: AuditEvent[] = [];
    const recorder: AuditRecorder = {
      async record(event, tx) {
        recorded.push(event);
        expect(tx).toBeUndefined();
      },
    };

    const success: AuditEvent = {
      organizationId: 'org-1',
      actorType: 'USER',
      actorId: 'user-1',
      action: 'CALCULATE_RISK_SCORE',
      resource: 'rule',
      resourceId: 'rule-1',
      detail: { riskScore: 10 },
      ipAddress: null,
    };
    const failure: AuditEvent = {
      ...success,
      action: 'SCORING_RULE_EVALUATION_FAILED',
      detail: { reason: 'engine threw' },
    };
    const createAudit: AuditEvent = {
      ...success,
      action: 'CREATE_SCORING_RULE',
      detail: { name: 'draft' },
    };
    const activateAudit: AuditEvent = {
      ...success,
      action: 'ACTIVATE_SCORING_RULE',
      detail: { name: 'draft' },
    };

    await recorder.record(success);
    await recorder.record(failure);
    await recorder.record(createAudit);
    await recorder.record(activateAudit);

    expect(recorded.map((event) => event.action)).toEqual([
      'CALCULATE_RISK_SCORE',
      'SCORING_RULE_EVALUATION_FAILED',
      'CREATE_SCORING_RULE',
      'ACTIVATE_SCORING_RULE',
    ]);
    expect(recorded[0]?.resource).toBe('rule');
  });

  it('UnitOfWork.withTransaction threads an opaque Transaction', async () => {
    const unitOfWork: UnitOfWork = {
      async withTransaction(work) {
        return work({} as Transaction);
      },
    };

    const result = await unitOfWork.withTransaction(async (tx) => {
      expect(tx).toBeDefined();
      return 'ok';
    });

    expect(result).toBe('ok');
  });
});
