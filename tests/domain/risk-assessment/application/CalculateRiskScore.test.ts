import { createCalculateRiskScoreUseCase } from '../../../../src/modules/risk-assessment/application/CalculateRiskScore.js';
import type {
  RiskScoringEngine,
  RiskScoringEvaluation,
} from '../../../../src/modules/risk-assessment/domain/ports/RiskScoringEngine.js';
import { RiskScoringRule } from '../../../../src/modules/risk-assessment/domain/model/aggregates/RiskScoringRule.js';
import { generateRiskScoringRuleId } from '../../../../src/modules/risk-assessment/domain/model/value-objects/RiskScoringRuleId.js';
import { createCanonicalRiskEvent } from '../../../../src/modules/risk-assessment/domain/model/CanonicalRiskEvent.js';
import { RiskAssessmentError } from '../../../../src/modules/risk-assessment/domain/errors/RiskAssessmentError.js';
import { InMemoryRiskScoringRuleRepository } from '../../../helpers/risk-assessment/InMemoryRiskScoringRuleRepository.js';
import { InMemoryRiskAssessmentAuditRecorder } from '../../../helpers/risk-assessment/InMemoryRiskAssessmentAuditRecorder.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const ORG = 'org-1';
const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-06-01T00:00:00.000Z'));

class ScriptedRiskScoringEngine implements RiskScoringEngine {
  private readonly queue: RiskScoringEvaluation[];
  readonly calls: Array<{
    conditions: Readonly<Record<string, unknown>>;
    context: Readonly<Record<string, unknown>>;
  }> = [];

  constructor(evaluations: RiskScoringEvaluation[]) {
    this.queue = [...evaluations];
  }

  async evaluate(
    conditions: Readonly<Record<string, unknown>>,
    context: Readonly<Record<string, unknown>>,
  ): Promise<RiskScoringEvaluation> {
    this.calls.push({ conditions, context });
    return this.queue.shift() ?? { riskScore: -1 };
  }
}

class ThrowingRiskScoringEngine implements RiskScoringEngine {
  readonly calls: unknown[] = [];

  async evaluate(
    conditions: Readonly<Record<string, unknown>>,
    context: Readonly<Record<string, unknown>>,
  ): Promise<RiskScoringEvaluation> {
    this.calls.push({ conditions, context });
    throw new Error('invalid JDM graph');
  }
}

class ThrowingOnceRiskScoringEngine implements RiskScoringEngine {
  calls = 0;

  constructor(private readonly then: RiskScoringEvaluation) {}

  async evaluate(): Promise<RiskScoringEvaluation> {
    this.calls += 1;
    if (this.calls === 1) {
      throw new Error('invalid JDM graph');
    }
    return this.then;
  }
}

function buildEvent(overrides: Record<string, unknown> = {}) {
  return createCanonicalRiskEvent({
    provider: 'stripe',
    providerEventType: 'charge.dispute.created',
    caseCustomerId: 'cust-1',
    amountCents: 2500,
    currency: 'USD',
    riskSignals: { providerRiskScore: 80 },
    createdAt: NOW,
    rawPayload: { secret: 'do-not-send' },
    ...overrides,
  });
}

function buildRule(overrides: Partial<Parameters<typeof RiskScoringRule.create>[0]> = {}): RiskScoringRule {
  return RiskScoringRule.create({
    id: generateRiskScoringRuleId(),
    organizationId: ORG,
    name: 'score-graph',
    conditions: { graph: 'oldest' },
    conditionsVersion: 1,
    now: NOW,
    ...overrides,
  });
}

function tenantAuth(organizationId: string | null = ORG) {
  return createAuthContext({
    userId: 'user-1',
    organizationId,
    actorType: organizationId === null ? 'PLATFORM_ADMIN' : 'USER',
    ipAddress: '10.0.0.1',
  });
}

function buildUseCase(engine: RiskScoringEngine, rules: RiskScoringRule[]) {
  const scoringRules = new InMemoryRiskScoringRuleRepository();
  rules.forEach((rule) => scoringRules.add(rule));
  const auditRecorder = new InMemoryRiskAssessmentAuditRecorder();
  const calculateRiskScore = createCalculateRiskScoreUseCase({
    scoringRules,
    scoringEngine: engine,
    auditRecorder,
  });
  return { calculateRiskScore, scoringRules, auditRecorder };
}

describe('createCalculateRiskScoreUseCase', () => {
  it('returns riskScore and provenance without persisting the event or creating a Case', async () => {
    const engine = new ScriptedRiskScoringEngine([{ riskScore: 72 }]);
    const rule = buildRule({ name: 'dispute-score', conditionsVersion: 4 });
    const { calculateRiskScore, scoringRules } = buildUseCase(engine, [rule]);
    const event = buildEvent();

    const result = await calculateRiskScore({ auth: tenantAuth(), event });

    expect(result.riskScore).toBe(72);
    expect(result.ruleId).toBe(rule.id);
    expect(result.name).toBe('dispute-score');
    expect(result.conditionsVersion).toBe(4);
    expect(result).not.toHaveProperty('rawPayload');
    expect(result).not.toHaveProperty('customerId');
    expect(result).not.toHaveProperty('assignedTo');
    expect(event.rawPayload).toEqual({ secret: 'do-not-send' });
    expect(scoringRules.all()).toHaveLength(1);
  });

  it('omits rawPayload from the engine context while keeping other camelCase fields', async () => {
    const engine = new ScriptedRiskScoringEngine([{ riskScore: 40 }]);
    const { calculateRiskScore } = buildUseCase(engine, [buildRule()]);

    await calculateRiskScore({ auth: tenantAuth(), event: buildEvent() });

    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0]?.context).not.toHaveProperty('rawPayload');
    expect(engine.calls[0]?.context).toMatchObject({
      provider: 'stripe',
      providerEventType: 'charge.dispute.created',
      caseCustomerId: 'cust-1',
      amountCents: 2500,
      currency: 'USD',
      riskSignals: { providerRiskScore: 80 },
    });
  });

  it('evaluates the sole ACTIVE rule returned by the repository (unique ACTIVE per org)', async () => {
    const engine = new ScriptedRiskScoringEngine([{ riskScore: 11 }]);
    const soleActive = buildRule({ name: 'sole-active', conditions: { graph: 'sole' }, now: NOW });
    const { calculateRiskScore } = buildUseCase(engine, [soleActive]);

    const result = await calculateRiskScore({ auth: tenantAuth(), event: buildEvent() });

    expect(result.riskScore).toBe(11);
    expect(result.ruleId).toBe(soleActive.id);
    expect(result.name).toBe('sole-active');
    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0]?.conditions).toEqual({ graph: 'sole' });
  });

  it('records CALCULATE_RISK_SCORE on success with rule provenance', async () => {
    const engine = new ScriptedRiskScoringEngine([{ riskScore: 55 }]);
    const rule = buildRule({ name: 'high-risk', conditionsVersion: 7 });
    const { calculateRiskScore, auditRecorder } = buildUseCase(engine, [rule]);

    await calculateRiskScore({ auth: tenantAuth(), event: buildEvent() });

    const events = auditRecorder.all();
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('CALCULATE_RISK_SCORE');
    expect(events[0]?.resource).toBe('rule');
    expect(events[0]?.resourceId).toBe(rule.id);
    expect(events[0]?.organizationId).toBe(ORG);
    expect(events[0]?.actorId).toBe('user-1');
    expect(events[0]?.detail).toMatchObject({
      ruleName: 'high-risk',
      conditionsVersion: 7,
      riskScore: 55,
    });
  });

  it('fails closed with SCORING_RULE_NOT_FOUND when the org has no ACTIVE rule', async () => {
    const engine = new ScriptedRiskScoringEngine([{ riskScore: 10 }]);
    const inactive = buildRule({ status: 'INACTIVE' });
    const { calculateRiskScore, auditRecorder } = buildUseCase(engine, [inactive]);

    await expect(calculateRiskScore({ auth: tenantAuth(), event: buildEvent() })).rejects.toMatchObject({
      code: 'SCORING_RULE_NOT_FOUND',
    });
    expect(engine.calls).toHaveLength(0);
    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('fails closed when evaluation throws and does not evaluate a later ACTIVE rule', async () => {
    const engine = new ThrowingOnceRiskScoringEngine({ riskScore: 10 });
    const first = buildRule({ name: 'broken', now: NOW });
    const rescue = buildRule({ name: 'rescue', now: LATER });
    const { calculateRiskScore, auditRecorder } = buildUseCase(engine, [first, rescue]);

    await expect(calculateRiskScore({ auth: tenantAuth(), event: buildEvent() })).rejects.toBeInstanceOf(
      RiskAssessmentError,
    );
    expect(engine.calls).toBe(1);
    const events = auditRecorder.all();
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('SCORING_RULE_EVALUATION_FAILED');
    expect(events[0]?.resource).toBe('rule');
    expect(events[0]?.resourceId).toBe(first.id);
    expect(events[0]?.detail).toMatchObject({
      ruleName: 'broken',
      conditionsVersion: 1,
      reason: 'invalid JDM graph',
    });
    expect(events.some((event) => event.action === 'CALCULATE_RISK_SCORE')).toBe(false);
  });

  it('audits SCORING_RULE_EVALUATION_FAILED when the selected graph cannot evaluate', async () => {
    const rule = buildRule({ name: 'broken-rule', conditionsVersion: 3 });
    const { calculateRiskScore, auditRecorder } = buildUseCase(new ThrowingRiskScoringEngine(), [rule]);

    await expect(calculateRiskScore({ auth: tenantAuth(), event: buildEvent() })).rejects.toMatchObject({
      code: 'INVARIANT_VIOLATION',
    });
    expect(auditRecorder.all()[0]?.action).toBe('SCORING_RULE_EVALUATION_FAILED');
  });

  it('rejects an out-of-range engine integer without clamping', async () => {
    const engine = new ScriptedRiskScoringEngine([{ riskScore: 101 }]);
    const { calculateRiskScore, auditRecorder } = buildUseCase(engine, [buildRule()]);

    await expect(calculateRiskScore({ auth: tenantAuth(), event: buildEvent() })).rejects.toMatchObject({
      code: 'INVARIANT_VIOLATION',
    });
    expect(auditRecorder.all().some((event) => event.action === 'CALCULATE_RISK_SCORE')).toBe(false);
  });

  it('rejects a non-integer engine output without clamping', async () => {
    const engine = new ScriptedRiskScoringEngine([{ riskScore: 50.5 }]);
    const { calculateRiskScore } = buildUseCase(engine, [buildRule()]);

    await expect(calculateRiskScore({ auth: tenantAuth(), event: buildEvent() })).rejects.toMatchObject({
      code: 'INVARIANT_VIOLATION',
    });
  });

  it('rejects a missing tenant context before loading rules', async () => {
    const engine = new ScriptedRiskScoringEngine([{ riskScore: 1 }]);
    const { calculateRiskScore, auditRecorder } = buildUseCase(engine, [buildRule()]);

    await expect(
      calculateRiskScore({ auth: tenantAuth(null), event: buildEvent() }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
    expect(engine.calls).toHaveLength(0);
    expect(auditRecorder.all()).toHaveLength(0);
  });
});
