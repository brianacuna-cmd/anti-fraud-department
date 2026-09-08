import { createSimulateScoringRuleUseCase } from '../../../../src/modules/risk-assessment/application/SimulateScoringRule.js';
import type {
  RuleSimulation,
  RuleSimulationEngine,
} from '../../../../src/modules/risk-assessment/domain/ports/RuleSimulationEngine.js';
import { createCanonicalRiskEvent } from '../../../../src/modules/risk-assessment/domain/model/CanonicalRiskEvent.js';
import { InMemoryRiskAssessmentAuditRecorder } from '../../../helpers/risk-assessment/InMemoryRiskAssessmentAuditRecorder.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const ORG = 'org-1';
const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const DRAFT_GRAPH = { graph: 'draft' };

class ScriptedRuleSimulationEngine implements RuleSimulationEngine {
  readonly calls: Array<{
    conditions: Readonly<Record<string, unknown>>;
    context: Readonly<Record<string, unknown>>;
  }> = [];

  constructor(private readonly outcome: RuleSimulation | Error) {}

  async simulate(
    conditions: Readonly<Record<string, unknown>>,
    context: Readonly<Record<string, unknown>>,
  ): Promise<RuleSimulation> {
    this.calls.push({ conditions, context });
    if (this.outcome instanceof Error) {
      throw this.outcome;
    }
    return this.outcome;
  }
}

function supervisorAuth() {
  return createAuthContext({
    userId: 'user-1',
    organizationId: ORG,
    actorType: 'USER',
    roleId: 'SUPERVISOR',
    ipAddress: '10.0.0.1',
  });
}

function buildEvent() {
  return createCanonicalRiskEvent({
    provider: 'stripe',
    providerEventType: 'charge.dispute.created',
    caseCustomerId: 'cust-1',
    amountCents: 2500,
    currency: 'USD',
    riskSignals: { providerRiskScore: 80 },
    createdAt: NOW,
    rawPayload: { secret: 'do-not-send' },
  });
}

function simulation(result: unknown): RuleSimulation {
  return { performance: '1ms', result };
}

function buildUseCase(engine: RuleSimulationEngine) {
  const auditRecorder = new InMemoryRiskAssessmentAuditRecorder();
  return {
    simulateScoringRule: createSimulateScoringRuleUseCase({
      simulationEngine: engine,
      auditRecorder,
    }),
    auditRecorder,
  };
}

describe('createSimulateScoringRuleUseCase', () => {
  it('warns when an object hit lacks a string because without fail-closing', async () => {
    const engine = new ScriptedRuleSimulationEngine(
      simulation({ riskScore: 40, hits: [{ points: 10 }] }),
    );
    const { simulateScoringRule } = buildUseCase(engine);

    const result = await simulateScoringRule({
      auth: supervisorAuth(),
      conditions: DRAFT_GRAPH,
      event: buildEvent(),
    });

    expect(result).toMatchObject({
      ok: true,
      riskScore: 40,
    });
    if (result.ok) {
      expect(result.warning).toContain('because');
      expect(result.warning).not.toBeNull();
    }
  });

  it('does not warn when every object hit has a string because', async () => {
    const engine = new ScriptedRuleSimulationEngine(
      simulation({ riskScore: 40, hits: [{ points: 10, because: 'high amount' }] }),
    );
    const { simulateScoringRule } = buildUseCase(engine);

    const result = await simulateScoringRule({
      auth: supervisorAuth(),
      conditions: DRAFT_GRAPH,
      event: buildEvent(),
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        riskScore: 40,
        warning: null,
      }),
    );
  });

  it('appends a because warning onto an existing riskScore warning', async () => {
    const engine = new ScriptedRuleSimulationEngine(
      simulation({ riskScore: 140, hits: [{ points: 10 }] }),
    );
    const { simulateScoringRule } = buildUseCase(engine);

    const result = await simulateScoringRule({
      auth: supervisorAuth(),
      conditions: DRAFT_GRAPH,
      event: buildEvent(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.riskScore).toBeNull();
      expect(result.warning).toContain('between 0 and 100');
      expect(result.warning).toContain('because');
    }
  });

  it('warns when because is present but not a string', async () => {
    const engine = new ScriptedRuleSimulationEngine(
      simulation({ riskScore: 18, hits: [{ points: 5, because: 99 }] }),
    );
    const { simulateScoringRule } = buildUseCase(engine);

    const result = await simulateScoringRule({
      auth: supervisorAuth(),
      conditions: DRAFT_GRAPH,
      event: buildEvent(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.riskScore).toBe(18);
      expect(result.warning).toContain('because');
    }
  });

  it('does not warn for non-object hits', async () => {
    const engine = new ScriptedRuleSimulationEngine(simulation({ riskScore: 22, hits: [10, 'skip'] }));
    const { simulateScoringRule } = buildUseCase(engine);

    const result = await simulateScoringRule({
      auth: supervisorAuth(),
      conditions: DRAFT_GRAPH,
      event: buildEvent(),
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        riskScore: 22,
        warning: null,
      }),
    );
  });
});
